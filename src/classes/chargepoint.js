const fs = require('fs');
const path = require('path');
const shortid = require('shortid');
const sqlite3 = require('sqlite3');
const WebSocketClient = require('websocket').client;
const Session = require('./session');
const random = require('../utils/random');

const cpfileroot = path.join(__dirname, '../..', 'charge-points');

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
                <Action>: <cb>,
                .
                .
                .
            }
        */
        this.callHandlers = {};

        this.uids = [];
        this.sessions = [];

        if (cpfile.serialno) {
            this.serialno = cpfile.serialno;

            if (Array.isArray(cpfile.uids)) {
                this.uids = shuffle(cpfile.uids);

                if (Array.isArray(cpfile.sessions)) {
                    cpfile.sessions.forEach(sess => {
                        if (this.uids.includes(sess.uid)) {
                            this.sessions.push(sess);
                        }
                    });
                }
            }
        }

        // Logs SQLite db for logs
        this.logsFile = path.join(cpfileroot, this.serialno + '.logs.db');
        this.logsDb = new sqlite3.Database(this.logsFile, function (err) {
            if (err) {
                this.logsDb = null;
                console.error(err.message);
            }
        });
        // Create table if not exists
        this.logsDb.run('CREATE TABLE IF NOT EXISTS `logs` ( `sno` INTEGER PRIMARY KEY AUTOINCREMENT , `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP , `type` VARCHAR(15) NOT NULL , `message` TEXT NOT NULL );',
            (err) => {
                if (err) {
                    console.error('Unable to create logs table:', err);
                }
            }
        );


        // Parameters of the cp
        this.params = cpfile.params || {};

        // An instance of Socket.io io()
        this._io = null;

        // Whether the cp has been accepted by the beackend. Can be set by sending BootNotification
        this.accepted = false;

        // The status of the cp. Available/Occupied
        this.status = 'Available';

        // Setting meter value (wh)
        this.meterValue = cpfile.meterValue || 0;

        // Index to keep track of which driver uid is currently charging
        this.chargeIndex = 0;

        // Min and max pause between two charging sessions in minutes
        this.minPause = this.getParam('minPause') || this.setParam('minPause', 15);
        this.maxPause = this.getParam('maxPause') || this.setParam('maxPause', 10 * 60);

        // Start saving
        setInterval(() => {
            this.save().catch(err => {
                console.error(err);
                this.io.cps_emit('err', `Failed to save: ${err.message}`);
            })
        }, 30000);
    }

    get io() {
        if (!this._io) {
            throw new Error('Socket io instance not set yet');
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

    getParam(param) {
        return this.params[param];
    }
    setParam(param, val) {
        if (param) {
            this.params[param] = val;
        }
        return val;
    }

    save() {
        return new Promise((resolve, reject) => {
            var cp = this;
            this.io.emit('save', 'saving');
            var data = JSON.stringify({
                serialno: this.serialno,
                uids: this.uids,
                meterValue: this.meterValue,
                params: this.params,
                sessions: this.sessions.map(s => typeof s.savable == 'function' ? s.savable() : s),
                //log: this.io.cps_msglog
            }, null, 2);

            // Write
            fs.writeFile(path.join(cpfileroot, this.serialno + '.json'), data, (err) => {
                if (err) return reject(err);

                if (this.io.cps_msglog.length > 0) {
                    var sql = `INSERT INTO logs (type, message) VALUES`;
                    var params = [];
                    this.io.cps_msglog.forEach(log => {
                        sql += `\n(?, ?),`;
                        params.push(log.type);
                        params.push(log.message);
                    });
                    sql = sql.substring(0, sql.length - 1);

                    this.logsDb.run(sql, params, function (err) {
                        if (err) return reject(err);

                        cp.io.cps_msglog = [];
                        cp.io.emit('save', 'saved');
                        resolve();
                    });
                } else {
                    // No need to save in db
                    this.io.emit('save', 'saved');
                    resolve();
                }
            });
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.io.cps_emit('message', 'Trying to connect...');

            var key = Buffer.from(process.env.KEY, 'hex').toString();
            var basicAuth = Buffer.from(`${this.serialno}:${key}`).toString('base64');
            var url = `${process.env.BACKENDURL}/${this.serialno}`

            this.client = new WebSocketClient();
            this.client.connect(url, 'ocpp1.5', null, {
                Authorization: `Basic ${basicAuth}`,
            });

            this.client.on('connectFailed', (error) => {
                this.io.cps_emit('err', 'Connection Error: ' + error.toString());
            });

            this.client.on('connect', connection => {
                this.io.cps_emit('success', `CP #${this.serialno} has successfuly connected to the backend`);

                this.connection = connection;

                connection.on('error', (error) => {
                    this.io.cps_emit('err', "Connection Error: " + error.toString());
                });
                connection.on('close', async () => {
                    this.io.cps_emit('err', 'Websocket Connection Closed');
                    this.connection = null;
                    await this.connect();
                    await this.boot();
                });
                connection.on('message', (message) => {
                    const msg = JSON.parse(message.utf8Data);
                    const type = msg[0];
                    const id = msg[1];

                    if (type == 2) { // CALL
                        const action = msg[2];
                        const fn = this.callHandlers[action];

                        // Check if handlers are registered for the call
                        if (typeof fn == 'function') {
                            fn(msg, this.callRespond(msg));
                        }
                    }
                    else {
                        // Check if callbacks are registered for the response
                        if (this.callResultHandlers[id]) {
                            if (!Array.isArray(this.callResultHandlers[id])) {
                                this.callResultHandlers[id] = [this.callResultHandlers[id]];
                            }
                            this.callResultHandlers[id].forEach(cb => typeof cb == 'function' && cb(msg));
                            // After all response handled, removed the CALL
                            delete this.callResultHandlers[id];
                        }
                    }
                });
                resolve();
            });
        });
    }

    send(action = 'Heartbeat', payload = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connection) {
                return reject('Connection with the backend has not yet been established.\nPlease connect to the backend first.');
            }
            if (!this.accepted && action != 'BootNotification') {
                return reject('Charge-point has not yet been accepted by the backend.\nPlease send BootNotification first and then retry.');
            }
            const msgTypeId = 2;
            const uniqueId = 'msg_' + shortid.generate();
            const msg = JSON.stringify([msgTypeId, uniqueId, action, payload]);

            this.connection.sendUTF(msg);
            this.registerCall(uniqueId, resolve);
        });
    }

    callRespond(msg) {
        const self = this;

        function respond() {
            this.success = function (payload) {
                if (!self.connection) {
                    return self.io.cps_emit('err', 'Connection with the backend has not yet been established.\nPlease connect to the backend first.');
                }

                var response = JSON.stringify([3, msg[1], payload]);
                self.connection.sendUTF(response);
            }

            this.error = function () {

            }
        }

        return new respond;
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
            var retry = 10000;
            this.io.cps_emit('message', 'Sending BootNotification...');

            var msg = await this.send('BootNotification', {
                chargePointModel: 'HOMEADVANCED',
                chargePointVendor: 'eNovates',
            });

            var payload = msg[2];
            var status = payload.status;

            if (status == 'Accepted') {
                this.accepted = true;
                this.io.cps_emit('success', 'Charge point has been accepted');
                this.startHeartbeat(90 * 1000);
            }
            else if (status == 'Rejected') {
                this.accepted = false;
                this.io.cps_emit('err', `Charge-point has been rejected by the backend.\nRetying after ${retry / 1000}s...`);
                setTimeout(() => this.boot(), retry);
            }
        } catch (err) {
            this.io.cps_emit('err', err);
            this.io.cps_emit('message', `Will resend BootNotification after ${retry / 1000}s...`);
            this.accepted = false;
            setTimeout(() => this.boot(), retry);
        };
    }

    /**
     * Send heartbeat and possibily continue sending afterwards
     * @param {Number} resendAfter Miliseconds after which resend another heartbeat request. -1 for no resend.
     */
    async startHeartbeat(resendAfter = -1) {
        try {
            var msg = await this.send('Heartbeat');
            this.io.emit('heartbeat', resendAfter);
            if (resendAfter >= 0) {
                setTimeout(() => this.startHeartbeat(resendAfter), resendAfter);
            }
        } catch (err) {
            this.io.cps_emit('err', err);
        }
    }

    setStatus(status, connectorId = 0) {
        return new Promise((resolve, reject) => {
            this.status = status;
            this.send('StatusNotification', {
                connectorId,
                errorCode: 'NoError',
                status,
            }).then(msg => {
                this.io.cps_emit('success', `CP status has been set to ${this.status}`)
                resolve();
            }).catch(err => reject(err));
        });
    }

    start() {
        this.io.cps_emit('message', 'Starting auto-charge....');

        if (this.uids.length <= 0) {
            let errMSg = 'No driver UIDs added to start charging';
            this.io.cps_emit('err', errMSg);
            throw new Error(errMSg);
        }
        this.charge(this.uids[this.chargeIndex], this.onSessionEnd());
    }

    async charge(uid, onEnd, connectorId = 1) {
        if (this.uids.includes(uid)) {
            try {
                // set to preparing
                var msg = await this.setStatus('Available', connectorId);

                var msg = await this.send('Authorize', { idTag: uid });
                if (msg[2].idTagInfo.status != 'Accepted') {
                    this.io.cps_emit('err', `UID #${uid} wasn't accepted by backend. Skipping...`);
                    return onEnd();
                }

                // set to preparing
                var msg = await this.setStatus('Occupied', connectorId);

                var sess = new Session(uid, {
                    minEnergy: this.getParam('minEnergy'),
                    maxEnergy: this.getParam('maxEnergy'),
                    minPower: this.getParam('minPower'),
                    maxPower: this.getParam('maxPower'),
                });
                this.sessions.push(sess);
                // Set socket.io io()
                sess.io = this.io;

                var msg = await this.send('StartTransaction', {
                    connectorId,
                    idTag: sess.uid,
                    meterStart: this.meterValue,
                    timestamp: new Date,
                });

                // Setting transactionId
                sess.txId = msg[2].transactionId;
                // Start the charging
                sess.status = 'Accepted';
                sess.startCharging(onEnd);

                // Notify the frontend about this session
                this.io.cps_emit('session', sess.savable());

            } catch (error) {
                this.io.cps_emit('err', error.message);
            }
        } else {
            let errMsg = `The UID ${uid} isn't assigned to this chargepoint. Can't initiate the session.`;
            this.io.cps_emit('err', errMsg);
            throw new Error(errMsg);
        }
    }

    // A helper function that helps to loop charging session one after another
    onSessionEnd() {
        return async (sess) => {
            this.chargeIndex++;
            // If there's no next UID in list, then start from beginning
            if (!this.uids[this.chargeIndex]) {
                this.chargeIndex = 0;
            }
            var nextUid = this.uids[this.chargeIndex];

            // Check if previous transaction/session was accepted by the backend or not
            if (sess && sess.status == 'Accepted') {
                // First StopTransaction
                // and then start the next transaction/session
                this.io.cps_emit('message', `Trying to stop charging ${sess.id}...`);

                // Updating meterValue
                this.meterValue += sess.enerySpent * 1000;

                var msg = await this.send('StopTransaction', {
                    idTag: sess.uid,
                    meterStop: this.meterValue,
                    timestamp: new Date,
                    transactionId: sess.txId,
                });

                this.io.cps_emit('success', `${sess.id} has stopped charging`);

                // Set status to Available
                await this.setStatus('Available');

                // Carry on charging the next
                // Put a random pause
                let randomPause = random(this.minPause, this.maxPause);
                this.io.cps_emit('message', `Waiting ${randomPause} min until next charge`);
                setTimeout(() => this.charge(nextUid, this.onSessionEnd()), 60000 * randomPause);
            }
            // The previous session was not accepted. We can start the next transaction/session
            else {
                // Carry on charging the next
                this.charge(nextUid, this.onSessionEnd());
            }
        }
    }
}

module.exports = function (serial) {
    return new Promise((resolve, reject) => {
        fs.readFile(cpfileroot + serial + '.json', function (err, data) {
            var cpfile = { serialno: serial };
            if (!err) {
                try {
                    cpfile = JSON.parse(data);
                    cpfile.serialno = serial;
                } catch (err) {
                    console.error('The given cpfile is invalid JSON. Ignoring it.');
                }
            }

            var cp = new ChargePoint(cpfile);
            return resolve(cp);
        });
    });
}


function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;

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
