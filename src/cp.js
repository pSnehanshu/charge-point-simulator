const express = require("express");
const csv = require("csv-parse");
const fs = require("fs");
const path = require("path");

const cpfileroot = path.join(__dirname, "..", "charge-points");

module.exports = function (authFunction = null) {
  // Set an open auth function if not given
  if (typeof authFunction != "function") {
    authFunction = (req, res, next) => next();
  }

  const router = express.Router();

  router.get("/status", function (req, res) {
    let { currentSession } = req.cp;
    let status = "Paused";
    if (
      !(currentSession.stop instanceof Date) &&
      typeof currentSession.savable == "function"
    ) {
      status = "Charging";
    }
    res.send(status);
  });

  // Set auth gatekeeper
  router.use(authFunction);

  router.get("/", async function (req, res) {
    res.render("cp", {
      serialno: req.cp.serialno,
      sessions: req.cp.sessions,
      uids: req.cp.uids,
      minPause: req.cp.getParam("minPause"),
      maxPause: req.cp.getParam("maxPause"),
      minEnergy: req.cp.getParam("minEnergy"),
      maxEnergy: req.cp.getParam("maxEnergy"),
      minPower: req.cp.getParam("minPower"),
      maxPower: req.cp.getParam("maxPower"),
      startIdleTime: req.cp.getParam("startIdleTime"),
      endIdleTime: req.cp.getParam("endIdleTime"),
      model: req.cp.getParam("model"),
      vendor: req.cp.getParam("vendor"),
      ocppVersion: req.cp.getParam("ocppVersion"),
      heartbeat: req.cp.getParam("heartbeat"),
    });
  });

  router.get("/msglog", function (req, res) {
    req.cp.logsDb.all(
      `SELECT sno, timestamp, type, message FROM logs WHERE ${
        req.query.before ? "sno < ?" : "1 = ?"
      } ORDER BY sno DESC LIMIT 0, 20;`,
      req.query.before || 1,
      function (err, logs) {
        if (err) {
          return res.status(500).send(err.message);
        }

        // Reverse it because frontends needs in reversed
        logs = logs.reverse();
        // Append all the unsaved logs
        logs = [...logs, ...req.cp.io.cps_msglog];

        res.json(logs);
      }
    );
  });

  router.post("/connect", function (req, res) {
    // Please start the session only if it hasn't started yet.
    // Start the charging sessions
    req.cp
      .connect()
      .then(() => {})
      .catch((err) => {
        req.cp.io.cps_emit("err", "Unable to connect to backend.");
      });
    res.end();
  });

  router.post("/disconnect", function (req, res) {
    req.cp.disconnect();
    res.end();
  });

  // Start the auto-charging loop
  router.post("/start", function (req, res) {
    // Please start the session only if it hasn't started yet.
    // Start the charging sessions
    try {
      req.cp.start();
    } catch (error) {
      console.error(error.message);
    }
    res.end();
  });

  // Stop the auto-charging loop
  router.post("/stop-loop", function (req, res) {
    // Check whether loop is active
    if (!req.cp.inLoop) {
      req.cp.io.cps_emit("err", `Auto-charging loop isn't active.`);
    } else {
      // Stop the loop
      req.cp.inLoop = false;
    }
    res.end();
  });

  router.post("/heartbeat", function (req, res) {
    // Please start the session only if it hasn't started yet.
    // Start the charging sessions
    req.cp.startHeartbeat();
    res.end();
  });

  router.post("/boot", function (req, res) {
    req.cp.boot();
    res.end();
  });

  router.post("/save", function (req, res) {
    req.cp
      .save()
      .catch((err) =>
        req.cp.io.cps_emit("err", `Failed to save: ${err.message}`)
      );
    res.end();
  });

  router.post("/clear", function (req, res) {
    req.cp.log = [];
    req.cp.io.cps_msglog = [];
    req.cp.save();
    res.end();
  });

  router.post("/uid-upload", function (req, res) {
    if (!req.files.uids) {
      return res.sendStatus(400);
    }
    var file = req.files.uids;
    var data = Buffer.from(file.data).toString();

    // Parse the csv
    csv(data, {}, function (err, output) {
      if (err) {
        console.error(error);
        return res.sendStatus(400);
      }
      var uids = transpose(output)[0];
      req.cp.uids = arrayUnique(uids);
      res.redirect(`/cp/${req.cp.serialno}`);
    });
  });

  router.post("/stop/:sess_id", function (req, res) {
    var notFound = req.cp.sessions.every((session) => {
      if (
        session.id == req.params.sess_id &&
        typeof session.stopCharging == "function"
      ) {
        try {
          session.stopCharging();
        } catch (error) {
          req.cp.io.cps_emit("err", error.message);
        }
        return false;
      }
      return true;
    });
    res.send({ found: !notFound });
  });

  router.post("/params", function (req, res) {
    for (param in req.body) {
      if (req.body[param].trim().length > 0)
        req.cp.setParam(param, req.body[param]);
    }
    // Finally
    req.cp.save().finally(() => res.redirect(`/cp/${req.cp.serialno}`));
  });

  router.post("/remove", function (req, res) {
    // Delete all related files
    // First fetch all the related files
    fs.readdir(cpfileroot, (err, files) => {
      if (err) {
        res.status(500).send(`Failed to remove chargepoint: ${err.message}`);
      } else {
        // Now delete the relevant files
        let promises = files
          .filter((f) => f.startsWith(`${req.serialno}.`))
          .map(
            (f) =>
              new Promise((resolve, reject) => {
                fs.unlink(path.join(cpfileroot, f), (err) => {
                  if (err) {
                    reject(new Error(`Error with file ${f}: ${err.message}`));
                  } else {
                    resolve();
                  }
                });
              })
          );

        Promise.all(promises)
          .then(async () => {
            // Now remove from global.chargepoints
            if (
              typeof global.chargepoints[req.serialno].destroy == "function"
            ) {
              await global.chargepoints[req.serialno].destroy();
            }
            delete global.chargepoints[req.serialno];
            res.redirect("/");
          })
          .catch((err) =>
            res.status(500).send(`Failed to remove chargepoint: ${err.message}`)
          );
      }
    });
  });

  return router;
};

/////////////////////////////////////////////////////////////////////

// Source: https://stackoverflow.com/a/17428705/9990365
function transpose(array = [[]]) {
  return array[0].map((col, i) => array.map((row) => row[i]));
}
// Source: https://stackoverflow.com/a/1584377/9990365
function arrayUnique(array) {
  var a = array.concat();
  for (var i = 0; i < a.length; ++i) {
    for (var j = i + 1; j < a.length; ++j) {
      if (a[i] === a[j]) a.splice(j--, 1);
    }
  }
  return a;
}
