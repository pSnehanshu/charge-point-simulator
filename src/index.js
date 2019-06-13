require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const fileUpload = require('express-fileupload');
const ChargePoint = require('./classes/chargepoint');
const cp = require('./cp');

// Express housekeeping
const port = process.env.PORT || 4300;
const app = express();
app.listen(port, () => console.log(`App listening on port ${port}...`));
app.set('view engine', 'pug');
app.set('views', './src/views');
app.use(helmet());
app.use('/static', express.static('./src/static'));
app.use(fileUpload());

/* Structure of Charge point storage
{
    <serialNo>: <cpInstance>
}
*/
global.chargepoints = {};

// Actual routes
app.get('/', function (req, res) {
    res.render('index');
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
}, cp);

// Finally, the 404 handler
app.all('*', function (req, res) {
    res.status(404).render('404');
});
