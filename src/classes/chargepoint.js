const fs = require("fs");
const path = require("path");
const shortid = require("shortid");
const sqlite3 = require("sqlite3");
const async = require("async");
const _ = require("lodash");
const WebSocketClient = require("websocket").client;
const Session = require("./session");
const random = require("../utils/random");
const socket = require("../utils/socket");

const cpfileroot = path.join(__dirname, "../..", "charge-points");

class ChargePoint {
  constructor(cpfile = {}) {
    /* Structure of CallResult Handlers
            {
                <UniqueId>: [<cb>, ...],
                .
                .
                .
            }
        */
    this.callResultHandlers = {};

    /* Structure of CallHandlers
            {
                <Action>: <cb>, cb receives err and msg
                .
                .
                .
            }
        */
    this.callHandlers = {};

    /* Structure of pendingCalls
            {
                <RandomID>: {
                    msg: <string>
                    handler: <function>,
                    errorHandler: <function>
                },
                .
                .
                .
            }
        */
    this.pendingCalls = {};

    this.uids = [];
    this.sessions = [];

    if (cpfile.serialno) {
      this.serialno = cpfile.serialno;

      if (Array.isArray(cpfile.uids)) {
        this.uids = shuffle(cpfile.uids);

        if (Array.isArray(cpfile.sessions)) {
          cpfile.sessions.forEach((sess) => {
            if (this.uids.includes(sess.uid)) {
              this.sessions.push(sess);
            }
          });
        }
      }
    }

    // Logs SQLite db for logs
    this.logsFile = path.join(cpfileroot, this.serialno + ".logs.db");
    this.logsDb = new sqlite3.Database(this.logsFile, (err) => {
      if (err) {
        this.logsDb = null;
        console.error(err.message);
      }
    });
    // Create table if not exists
    this.logsDb.run(
      "CREATE TABLE IF NOT EXISTS `logs` ( `sno` INTEGER PRIMARY KEY AUTOINCREMENT , `timestamp` INTEGER NOT NULL , `type` VARCHAR(15) NOT NULL , `message` TEXT NOT NULL );",
      (err) => {
        if (err) {
          console.error("Unable to create logs table:", err);
        }
      }
    );

    // Default parameters of the cp
    this.params = {
      minPause: "23",
      maxPause: "44",
      minEnergy: "26",
      maxEnergy: "68",
      minPower: "11",
      maxPower: "22",
      startIdleTime: "01:10",
      endIdleTime: "04:09",
      model: "HOMEADVANCED",
      vendor: "eNovates",
      ocppVersion: "ocpp1.5",
      heartbeat: 90, // seconds
      ...cpfile.params,
    };

    // An instance of Socket.io io()
    this._io = null;

    // Whether the cp has been accepted by the beackend. Can be set by sending BootNotification
    this.accepted = false;

    // The status of the cp. Available/Occupied
    this.status = "Available";

    // Setting meter value (wh)
    this.meterValue = Math.ceil(cpfile.meterValue) || 0;

    // A flag to determine whether an auto-charging loop is active or not
    // Please use .inLoop getter instead of this.
    this._inLoop = false;

    // True means the user tried to gracefully disconnect, no need to automatically reconnect
    this.manual_close = false;

    // The JavaScript timers, will need to be cleared if cp is destroyed
    this.timers = {};

    // Start saving
    this.registerTimer(
      "save",
      setInterval(() => {
        this.save().catch((err) => {
          console.error(err);
          this.io.cps_emit("err", `Failed to save: ${err.message}`);
        });
      }, 30000)
    );
  }

  get inLoop() {
    return !!this._inLoop;
  }
  set inLoop(v) {
    if (!v && this._inLoop) {
      // Actually stop the loop
      if (typeof this.currentSession.stopCharging == "function") {
        this.currentSession.stopCharging();
      }

      // Notify UI
      this.io.cps_emit("success", "The auto-charging loop has been stopped.");
    }
    this._inLoop = !!v;
  }

  get io() {
    if (!this._io) {
      throw new Error("Socket io instance not set yet");
    }
    return this._io;
  }
  set io(io) {
    this._io = io;
  }

  get currentSession() {
    if (this.sessions.length <= 0) {
      return {};
    }
    var lastSession = this.sessions[this.sessions.length - 1];
    // Check if it has ended
    if (lastSession.stop instanceof Date) {
      return {};
    } else {
      return lastSession;
    }
  }

  get idleTimeMessage() {
    let d = new Date();
    let currentTime = `${d.getUTCHours()}:${d.getUTCMinutes()}`;
    return `It's idle time, no charging until ${this.getParam(
      "endIdleTime"
    )} UTC. Currently ${currentTime} UTC.`;
  }

  getParam(param, defaultVal = "") {
    return _.get(this.params, param, defaultVal);
  }
  setParam(param, val) {
    _.set(this.params, param, val);
    return val;
  }

  save() {
    return new Promise((resolve, reject) => {
      this.io.emit("save", "saving");
      var data = JSON.stringify(
        {
          serialno: this.serialno,
          uids: this.uids,
          meterValue: this.meterValue,
          params: this.params,
          sessions: this.sessions.map((s) =>
            typeof s.savable == "function" ? s.savable() : s
          ),
        },
        null,
        2
      );

      // Write
      fs.writeFile(
        path.join(cpfileroot, this.serialno + ".json"),
        data,
        (err) => {
          if (err) {
            console.error("Error while saving config", err);
            return reject(err);
          }

          if (this.io.cps_msglog.length > 0) {
            let msglog_batches = [];
            let msglog_batch = [];
            let batch_size = 20;
            let i = 0;
            this.io.cps_msglog.forEach((log) => {
              i++;
              msglog_batch.push(log);
              if (i >= batch_size) {
                msglog_batches.push(msglog_batch);
                msglog_batch = [];
                i = 0;
              }
            });
            msglog_batches.push(msglog_batch);

            async.waterfall(
              msglog_batches.map((batch) => (cb) => {
                let sql = `INSERT INTO logs (type, message, timestamp) VALUES`;
                let params = [];
                batch.forEach((log) => {
                  sql += `\n(?, ?, ?),`;
                  params.push(log.type);
                  params.push(log.message);
                  params.push(log.timestamp);
                });
                sql = sql.substring(0, sql.length - 1);

                this.logsDb.run(sql, params, (err) => {
                  if (err) return cb(err);
                  else cb(null);
                });
              }),
              (err, result) => {
                if (err) {
                  console.error("Error while saving logs", err);
                  reject(err);
                } else {
                  this.io.cps_msglog = [];
                  this.io.emit("save", "saved");
                  resolve();
                }
              }
            );
          } else {
            // No need to save in db
            this.io.emit("save", "saved");
            resolve();
          }
        }
      );
    });
  }

  connect(reconnect = false) {
    return new Promise((resolve, reject) => {
      this.io.cps_emit("message", "Trying to connect...");
      this.manual_close = false;

      var key = Buffer.from(process.env.KEY, "hex").toString();
      var basicAuth = Buffer.from(`${this.serialno}:${key}`).toString("base64");
      var url = `${process.env.BACKENDURL}/${this.serialno}`;

      this.client = new WebSocketClient();
      this.client.connect(url, this.getParam("ocppVersion", "ocpp1.5"), null, {
        Authorization: `Basic ${basicAuth}`,
      });

      this.client.on("connectFailed", async (error) => {
        this.io.cps_emit("err", "Connection Error: " + error.toString());

        if (reconnect) {
          this.io.cps_emit(
            "err",
            `Unable to connect to backend. Will retry after ${reconnect}s`
          );

          this.registerTimer(
            "reconnect",
            setTimeout(() => {
              // Reconnecting
              this.connect(reconnect)
                .then(() => resolve())
                .catch((err) =>
                  console.error("Unable to connect to backend. Retrying...")
                );
            }, reconnect * 1000)
          );
        }
      });

      this.client.on("connect", (connection) => {
        this.io.cps_emit(
          "success",
          `CP #${this.serialno} has successfuly connected to the backend`
        );

        this.connection = connection;

        connection.on("error", (error) => {
          this.io.cps_emit(
            "err",
            "Connection Error: It did connect earlier: " + error.toString()
          );
        });
        connection.on("close", async (reasonCode, description) => {
          this.io.cps_emit(
            "err",
            `Websocket Connection Closed: (${reasonCode}) ${description}`
          );
          this.connection = null;

          // Clear all heartbeat timers
          this.clearTimers("heartbeat");

          if (this.manual_close) return;
          try {
            await this.connect(5);
            await this.boot();

            // Since reconnection is done, let's resend the pending message
            this.sendPendingCalls();
          } catch (error) {
            console.error("Unable to connect to backend. Retrying...");
          }
        });
        connection.on("message", (message) => {
          const msg = JSON.parse(message.utf8Data);
          const type = msg[0];
          const id = msg[1];

          if (type == 2) {
            // CALL
            const action = msg[2];
            const fn = this.callHandlers[action];

            // Check if handlers are registered for the call
            if (typeof fn == "function") {
              fn(msg, this.callRespond(msg));
            }
          } else {
            // Check if callbacks are registered for the response
            if (this.callResultHandlers[id]) {
              if (!Array.isArray(this.callResultHandlers[id])) {
                this.callResultHandlers[id] = [this.callResultHandlers[id]];
              }

              // Check if any error occured
              let error = null;
              if (type == 4) {
                error = new Error(
                  `${msg[2]}: "${msg[3]}".\n${JSON.stringify(msg[4], null, 2)}`
                );
              }
              this.callResultHandlers[id].forEach(
                (cb) => typeof cb == "function" && cb(error, msg)
              );

              // After all response handled, removed the CALL
              delete this.callResultHandlers[id];
            }
          }
        });
        resolve();
      });
    });
  }

  disconnect() {
    if (this.connection) {
      this.manual_close = true;
      this.io.cps_emit("message", "Gracefully closing the connection...");
      this.connection.close();
    } else {
      this.io.cps_emit("err", "Already disconnected");
    }
  }

  send(action = "Heartbeat", payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        return reject(
          new Error(
            "Connection with the backend has not yet been established.\nPlease connect to the backend first."
          )
        );
      }
      if (!this.accepted && action != "BootNotification") {
        return reject(
          new Error(
            "Charge-point has not yet been accepted by the backend.\nPlease send BootNotification first and then retry."
          )
        );
      }

      let msgTypeId = 2;
      let uniqueId = "msg_" + shortid.generate();
      let msg = "";
      if (typeof payload == "string") {
        let parsed = JSON.parse(payload);
        msgTypeId = parsed[0];
        uniqueId = parsed[1];
        msg = payload;
        payload = parsed[3];
      } else {
        msg = JSON.stringify([msgTypeId, uniqueId, action, payload]);
      }

      let pendingId = this.insertPendingCall(
        msg,
        (m) => resolve(m),
        (e) => reject(e)
      );
      this.connection.sendUTF(msg, (err) => {
        if (err) {
          this.clearPendingCall(pendingId);
          reject(err);
        } else {
          this.registerCall(uniqueId, (err, msg) => {
            this.clearPendingCall(pendingId);

            if (err) {
              reject(err);
            } else {
              resolve(msg);
            }
          });
        }
      });
    });
  }

  callRespond(msg) {
    const self = this;

    function respond() {
      this.success = function (payload) {
        if (!self.connection) {
          return self.io.cps_emit(
            "err",
            "Connection with the backend has not yet been established.\nPlease connect to the backend first."
          );
        }

        var response = JSON.stringify([3, msg[1], payload]);
        self.connection.sendUTF(response);
      };

      this.error = function (
        errorCode,
        errorDescription = "",
        errorDetails = {}
      ) {
        if (!self.connection) {
          return self.io.cps_emit(
            "err",
            "Connection with the backend has not yet been established.\nPlease connect to the backend first."
          );
        }

        var response = JSON.stringify([
          4,
          msg[1],
          errorCode,
          errorDescription,
          errorDetails,
        ]);
        self.connection.sendUTF(response);
      };
    }

    return new respond();
  }

  // Handle Calls
  on(action, cb) {
    // Finally add the callback
    this.callHandlers[action] = cb;
  }

  registerCall(id, cb) {
    // Create entry if new ID
    if (!this.callResultHandlers[id]) {
      this.callResultHandlers[id] = [];
    }
    // Check if it is array, if not make it one
    if (!Array.isArray(this.callResultHandlers[id])) {
      this.callResultHandlers[id] = [this.callResultHandlers[id]];
    }

    // Finally push the callback
    this.callResultHandlers[id].push(cb);
  }

  async boot() {
    try {
      this.accepted = false;
      var retry = 10000;
      this.io.cps_emit("message", "Sending BootNotification...");

      var msg = await this.send("BootNotification", {
        chargePointModel: this.getParam("model"),
        chargePointVendor: this.getParam("vendor"),
      });

      var payload = msg[2];
      var status = payload.status;

      if (status == "Accepted") {
        this.accepted = true;
        this.io.cps_emit("success", "Charge point has been accepted");

        // Clearing existing heartbeats
        this.clearTimers("heartbeat");

        // Start a heartbeat loop
        let heartbeat_interval = parseInt(this.getParam("heartbeat", 90));
        this.startHeartbeat(heartbeat_interval * 1000);
        return this.io.cps_emit(
          "message",
          `Heartbeat interval set at ${heartbeat_interval} sec`
        );
      } else if (status == "Rejected") {
        this.io.cps_emit(
          "err",
          `Charge-point has been rejected by the backend.\nRetying after ${
            retry / 1000
          }s...`
        );
        return this.registerTimer(
          "retry-boot",
          setTimeout(() => this.boot(), retry)
        );
      } else if (this.getParam("ocppVersion") == "ocpp1.6") {
        if (status == "Pending") {
          return this.io.cps_emit(
            "message",
            `The central system needs more information before the CP can be accepted. It will proceed automatically. Please don't take any action.`
          );
        }
      }

      this.io.cps_emit("err", "Invalid response");
    } catch (err) {
      this.io.cps_emit("err", err);
      this.io.cps_emit(
        "message",
        `Will resend BootNotification after ${retry / 1000}s...`
      );
      this.registerTimer(
        "retry-boot-on-error",
        setTimeout(() => this.boot(), retry)
      );
    }
  }

  /**
   * Send heartbeat and possibily continue sending afterwards
   * @param {Number} resendAfter Miliseconds after which resend another heartbeat request. -1 for no resend.
   */
  async startHeartbeat(resendAfter = -1) {
    try {
      let msg = await this.send("Heartbeat");
      this.io.emit("heartbeat", resendAfter);
      if (resendAfter >= 0) {
        this.registerTimer(
          "heartbeat",
          setTimeout(
            () =>
              this.startHeartbeat(
                parseInt(this.getParam("heartbeat", 90)) * 1000
              ),
            resendAfter
          )
        );
      }
    } catch (err) {
      this.io.cps_emit("err", err);
    }
  }

  setStatus(status, connectorId = 0) {
    return new Promise((resolve, reject) => {
      this.status = status;
      this.send("StatusNotification", {
        connectorId,
        errorCode: "NoError",
        status,
      })
        .then((msg) => {
          this.io.cps_emit(
            "success",
            `CP status has been set to ${this.status}`
          );
          resolve();
        })
        .catch((err) => reject(err));
    });
  }

  start() {
    // If already in a loop, then don't start new loop
    if (this.inLoop) {
      return this.io.cps_emit(
        "err",
        "Auto-charging loop is already active, please stop the loop before starting a new one."
      );
    }
    this.io.cps_emit("message", "Starting auto-charge....");

    if (this.uids.length <= 0) {
      let errMSg = "No driver UIDs added to start charging";
      this.io.cps_emit("err", errMSg);
      throw new Error(errMSg);
    }
    this.inLoop = true;
    this.charge(this.uids[0], this.onSessionEnd());
  }

  async charge(uid, onEnd, connectorId = 1) {
    if (this.uids.includes(uid)) {
      try {
        // Can't charge if status set to unavailable
        if (this.status === "Unavailable") {
          return this.io.cps_emit(
            "err",
            `Can't start session because status is "${this.status}"`
          );
        }

        let ocppVersion = this.getParam("ocppVersion", "ocpp1.5");

        // set to available
        var msg = await this.setStatus("Available", connectorId);

        var msg = await this.send("Authorize", { idTag: uid });
        if (msg[2].idTagInfo.status != "Accepted") {
          this.io.cps_emit(
            "err",
            `UID #${uid} wasn't accepted by backend. Skipping...`
          );
          return onEnd();
        }

        // set to preparing
        switch (ocppVersion) {
          case "ocpp1.5":
            await this.setStatus("Occupied", connectorId);
            break;
          case "ocpp1.6":
            await this.setStatus("Preparing", connectorId);
            break;
          default:
            return this.io.cps_emit(
              "err",
              `Unsupported OCPP version ${ocppVersion}`
            );
        }

        var sess = new Session(uid, {
          minEnergy: this.getParam("minEnergy"),
          maxEnergy: this.getParam("maxEnergy"),
          minPower: this.getParam("minPower"),
          maxPower: this.getParam("maxPower"),
        });
        this.sessions.push(sess);
        // Set socket.io io()
        sess.io = this.io;

        var msg = await this.send("StartTransaction", {
          connectorId,
          idTag: sess.uid,
          meterStart: this.meterValue,
          timestamp: new Date(),
        });

        // Setting transactionId
        sess.txId = msg[2].transactionId;
        sess.connectorId = connectorId;
        // Start the charging
        sess.status = "Accepted";
        sess.startCharging(onEnd);

        // Registering the session timer
        this.registerTimer("session", sess.worker);

        // Notify the frontend about this session
        this.io.cps_emit("session", sess.savable());

        // Set status to Charging
        if (ocppVersion == "ocpp1.6") {
          await this.setStatus("Charging", connectorId);
        }
      } catch (error) {
        this.io.cps_emit("err", error.message);
        return onEnd();
      }
    } else {
      let errMsg = `The UID ${uid} isn't assigned to this chargepoint. Can't initiate the session.`;
      this.io.cps_emit("err", errMsg);
      throw new Error(errMsg);
    }
  }

  // A helper function that helps to loop charging session one after another
  onSessionEnd() {
    return async (sess) => {
      // Choosing a random UID
      var nextUid = shuffle(this.uids)[0];

      // Check if previous transaction/session was accepted by the backend or not
      if (sess && sess.status == "Accepted") {
        // Set status to Finishing
        if (this.getParam("ocppVersion") == "ocpp1.6") {
          await this.setStatus("Finishing", sess.connectorId);
        }

        // First StopTransaction
        // and then start the next transaction/session
        this.io.cps_emit("message", `Trying to stop charging ${sess.id}...`);

        // Updating meterValue
        // FIX: Requested by Andrew to limit reported energy
        const MaxEnergy = 60; // kWh
        const MaxPower = 22; // kW
        const SessTimeElapsed = sess.elapsed / 60; // hours
        let consumedEnergy = sess.energySpent; // in kWh
        if (consumedEnergy > MaxEnergy) {
          consumedEnergy = MaxEnergy;
        }
        let meterEnd = this.meterValue + consumedEnergy * 1000; // in Wh
        if (consumedEnergy / SessTimeElapsed > MaxPower) {
          meterEnd = this.meterValue + (MaxPower * 1000) * SessTimeElapsed;
        }
        this.meterValue = Math.ceil(meterEnd);
        // FIX END

        await this.send("StopTransaction", {
          idTag: sess.uid,
          meterStop: this.meterValue,
          timestamp: new Date(),
          transactionId: sess.txId,
        });

        // Notify the frontend about this stoppage
        this.io.cps_emit("session", {});

        this.io.cps_emit("success", `${sess.id} has stopped charging`);

        // Set status to Available
        await this.setStatus("Available", sess.connectorId);

        // Check if loop has been distrupted
        if (!this.inLoop) {
          return;
        }

        // Carry on charging the next

        // Put a random pause
        let pause = random(
          this.getParam("minPause"),
          this.getParam("maxPause")
        );

        let time_after_pause = Date.now() + pause * 60000;

        if (this.isIdleTime(time_after_pause)) {
          // this.io.cps_emit("message", this.idleTimeMessage);
          pause +=
            (this.getIdleTime().endIdleTime - new Date(time_after_pause)) /
            60000;

          // Put another pause to make sure that session don't always start right after idle time ends
          pause += random(this.getParam("minPause"), this.getParam("maxPause"));
        }

        this.io.cps_emit(
          "message",
          `Waiting ${Math.round(pause)} min until next charge`
        );

        this.registerTimer(
          "next-session",
          setTimeout(() => {
            if (this.inLoop) {
              this.charge(nextUid, this.onSessionEnd());
            }
          }, 60000 * pause)
        );
      }
      // The previous session was not accepted. We can start the next transaction/session
      else {
        // Check if loop has been distrupted
        if (!this.inLoop) {
          return;
        }

        // Carry on charging the next
        if (this.isIdleTime()) {
          this.io.cps_emit("message", this.idleTimeMessage);
          let pause = (this.getIdleTime().endIdleTime - new Date()) / 60;
          this.registerTimer(
            "next-session-on-unaccepted",
            setTimeout(
              () => this.charge(nextUid, this.onSessionEnd()),
              60000 * pause
            )
          );
        } else {
          this.charge(nextUid, this.onSessionEnd());
        }
      }
    };
  }

  isIdleTime(time) {
    let { startIdleTime, endIdleTime } = this.getIdleTime();
    if (startIdleTime && endIdleTime) {
      let currentTime = new Date();
      if (time) {
        currentTime = new Date(time);
      }
      return currentTime > startIdleTime && currentTime < endIdleTime;
    } else {
      return false;
    }
  }

  getIdleTime() {
    let startIdleTime = this.getParam("startIdleTime");
    let endIdleTime = this.getParam("endIdleTime");

    let [startHour, startMinute] = startIdleTime.split(":");
    let [endHour, endMinute] = endIdleTime.split(":");

    startHour = parseInt(startHour);
    startMinute = parseInt(startMinute);
    endHour = parseInt(endHour);
    endMinute = parseInt(endMinute);

    if (
      isNaN(startHour) ||
      isNaN(startMinute) ||
      isNaN(endHour) ||
      isNaN(endMinute)
    ) {
      return { startIdleTime: null, endIdleTime: null };
    }

    startIdleTime = new Date();
    startIdleTime.setUTCHours(startHour, startMinute, 0, 0);

    endIdleTime = new Date();
    if (endHour < startHour) {
      endIdleTime.setUTCDate(endIdleTime.getUTCDate() + 1);
    }
    endIdleTime.setUTCHours(endHour, endMinute, 0, 0);

    return { startIdleTime, endIdleTime };
  }

  insertPendingCall(msg = "", handler, errorHandler) {
    if (!handler) handler = () => {};
    if (!errorHandler) errorHandler = () => {};

    do {
      var randomId = shortid.generate();
    } while (this.pendingCalls[randomId]);

    this.pendingCalls[randomId] = { msg, handler, errorHandler };
    return randomId;
  }

  clearPendingCall(randomId) {
    if (this.pendingCalls[randomId]) {
      delete this.pendingCalls[randomId];
    }
  }

  async sendPendingCalls() {
    for (let id in this.pendingCalls) {
      let call = this.pendingCalls[id];
      this.clearPendingCall(id);
      try {
        let response = await this.send("", call.msg);
        call.handler(response);
      } catch (error) {
        call.errorHandler(error);
      }
    }
  }

  registerTimer(name = "", timer) {
    if (typeof this.timers[name] == "undefined") {
      this.timers[name] = [];
    }

    if (!Array.isArray(this.timers[name])) {
      this.timers[name] = [this.timers[name]];
    }

    this.timers[name].push(timer);
  }

  clearTimers(name = "") {
    if (Array.isArray(this.timers[name])) {
      this.timers[name].forEach((t) => clearTimeout(t));
    } else {
      clearTimeout(this.timers[name]);
    }
    this.timers[name] = [];
  }

  // Stop all the node.js timers and the current active session (if exists)
  async destroy() {
    // Clear all the timers
    for (let timers in this.timers) {
      this.clearTimers(timers);
    }

    // TODO: Stop the current session (if exists)

    // Destroy all the handlers
    this.callResultHandlers = {};
    this.callHandlers = {};
    this.pendingCalls = {};
  }
}

module.exports = function (serial, io) {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(cpfileroot, serial + ".json"), function (err, data) {
      var cpfile = { serialno: serial };
      if (!err) {
        try {
          cpfile = JSON.parse(data);
          cpfile.serialno = serial;
        } catch (err) {
          console.error("The given cpfile is invalid JSON. Ignoring it.");
        }
      }

      var cp = new ChargePoint(cpfile);

      // Create a namespace if not exists
      if (!socket.namespaces[cp.serialno]) {
        socket.namespaces[cp.serialno] = io.of(`/${cp.serialno}`);
        socket.namespaces[cp.serialno].cps_msglog = [];
        socket.namespaces[cp.serialno].cps_emit = function (event, message) {
          if (typeof message == "object") message = JSON.stringify(message);

          // First record the message
          this.cps_msglog.push({ type: event, message, timestamp: Date.now() });
          this.emit(event, message);
        }.bind(socket.namespaces[cp.serialno]);
      }

      // Set it to req and give it to cp as well
      cp.io = socket.namespaces[cp.serialno];

      return resolve(cp);
    });
  });
};

function shuffle(array) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
