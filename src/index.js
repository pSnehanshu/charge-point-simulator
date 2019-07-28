require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const ChargePoint = require('./classes/chargepoint');
const socket = require('./socket');
const handleCall = require('./handleCall');

// Express housekeeping
const port = process.env.PORT || 4300;
const app = express();
const httpServer = app.listen(port, () => console.log(`App listening on port ${port}...`));

app.set('view engine', 'pug');
app.set('views', './src/views');
app.use(helmet());
app.use('/static', express.static('./src/static'));
app.use(fileUpload());
app.use(bodyParser.urlencoded({ extended: true }));

// Setup socket.io
socket.setup(httpServer);
const io = socket.io();

/* Structure of Charge point storage
{
    <serialNo>: <cpInstance>
}
*/
global.chargepoints = {};

// Actual routes
app.get('/', function (req, res) {
    res.render('index', {
        active: global.chargepoints
    });
});

app.get('/cp', function (req, res) {
    if (req.query.serial) {
        res.redirect(`/cp/${req.query.serial}`);
    } else {
        res.redirect('/');
    }
});

app.use('/cp/:serialno', async function (req, res, next) {
    req.serialno = req.params.serialno;
    if (global.chargepoints[req.serialno]) {
        req.cp = global.chargepoints[req.serialno];
    } else {
        req.cp = await ChargePoint(req.serialno);
        global.chargepoints[req.serialno] = req.cp;
    }

    next();
}, function (req, res, next) {
    // Create a namespace if not exists
    if (!socket.namespaces[req.serialno]) {
        socket.namespaces[req.serialno] = io.of(`/${req.serialno}`);
        socket.namespaces[req.serialno].cps_msglog = [];
        socket.namespaces[req.serialno].cps_emit = function (event, message) {
            if (typeof message == 'object') message = JSON.stringify(message);
            
            // First record the message
            this.cps_msglog.push({ type: event, message, timestamp: Date.now() });
            this.emit(event, message);
        }.bind(socket.namespaces[req.serialno]);
    } 

    // Set it to req and give it to cp as well
    req.cp.io = req.io = socket.namespaces[req.serialno];

    next();
}, function (req, res, next) {
    handleCall(req.cp)
    next();
}, require('./cp'));

// Finally, the 404 handler
app.all('*', function (req, res) {
    res.status(404).render('404');
});
