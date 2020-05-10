require("dotenv").config();

if (!(process.env.PASSWORD && process.env.SECRET)) {
  throw new Error("Please set PASSWORD and SECRET to start.");
}

const express = require("express");
const helmet = require("helmet");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
const glc = require("git-last-commit");
const ChargePoint = require("./classes/chargepoint");
const cpRoutes = require("./cp");
const socket = require("./utils/socket");
const handleCall = require("./utils/handleCall");
const token = require("./utils/token");
const Auth = require("./utils/auth");
const loadExistingChargers = require("./utils/loadExistingChargers");

glc.getLastCommit(function (err, commit) {
  if (err) {
    console.error("GLC", err);
  }

  main(commit);
});

async function main(lasCommit = null) {
  // Express housekeeping
  const port = process.env.PORT || 4300;
  const app = express();
  const httpServer = app.listen(port, () =>
    console.log(`App listening on port ${port}...`)
  );
  const tokenName = "cpstoken"; // The cookie name where the auth cookie is to be stored and checked
  const auth = Auth(tokenName); // The auth middleware

  app.set("view engine", "pug");
  app.set("views", "./src/views");
  app.use(helmet());
  app.use("/static", express.static("./src/static"));
  app.use(fileUpload());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Setup socket.io
  socket.setup(httpServer);
  const io = socket.io();

  /* Structure of Charge point storage
    {
        <serialNo>: <cpInstance>
    }
    */
  global.chargepoints = await loadExistingChargers(io);

  app.get("/last-commit.js", function (req, res) {
    res.set("Content-Type", "text/javascript");

    let js = `function getLastCommit() {`;
    js += `var lastCommit = ${JSON.stringify(lasCommit)};`;
    js += `console.log('Latest commit', lastCommit);`;
    js += `var now = Date.now() / 1000;`;
    js += `var timePassed = Math.round(now - parseInt(lastCommit.authoredOn));`;
    js += `var text = 'Last updated ' + millisecondsToStr(timePassed * 1000) + ' ago';`;
    js += `$('.last-commit-info').html(text);`;
    js += `return lastCommit`;
    js += `}`;

    res.send(js);
  });

  app.get("/login", function (req, res) {
    res.render("login");
  });

  app.post("/login", function (req, res) {
    let next = req.body.next || "/";

    if (req.body.password && req.body.password.length > 0) {
      if (req.body.password == process.env.PASSWORD) {
        // Generate a cookie
        return res.cookie(tokenName, token.generate()).redirect(next);
      } else {
        var loginParams = {
          message: "Incorrect password!",
          color: "red",
          next,
        };
      }
    } else {
      var loginParams = {
        message: "Please enter a password",
        color: "red",
        next,
      };
    }

    res.render("login", loginParams);
  });

  app.post("/logout", auth, function (req, res) {
    res.clearCookie(tokenName).redirect("/login");
  });

  // Actual routes
  app.get("/", auth, function (req, res) {
    res.render("index", {
      active: global.chargepoints,
    });
  });

  app.get("/cp", auth, function (req, res) {
    if (req.query.serial) {
      res.redirect(`/cp/${req.query.serial}`);
    } else {
      res.redirect("/");
    }
  });

  app.use(
    "/cp/:serialno",
    async function (req, res, next) {
      req.serialno = req.params.serialno;
      if (global.chargepoints[req.serialno]) {
        req.cp = global.chargepoints[req.serialno];
      } else {
        req.cp = await ChargePoint(req.serialno, io);
        global.chargepoints[req.serialno] = req.cp;
      }

      next();
    },
    function (req, res, next) {
      handleCall(req.cp);
      next();
    },
    cpRoutes(auth)
  );

  // Finally, the 404 handler
  app.all("*", function (req, res) {
    res.status(404).render("404");
  });
}
