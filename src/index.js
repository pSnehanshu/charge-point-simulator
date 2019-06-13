require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cp = require('./cp');

// Express housekeeping
const port = process.env.PORT || 4300;
const app = express();
app.listen(port, () => console.log(`App listening on port ${port}...`));
app.set('view engine', 'pug');
app.set('views', './src/views');
app.use(helmet());
app.use('/static', express.static('./src/static'));

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

app.use('/cp/:serialno', function (req, res, next) {
    req.serialno = req.params.serialno;
    next();
}, cp);

// Finally, the 404 handler
app.all('*', function (req, res) {
    res.status(404).render('404');
});
