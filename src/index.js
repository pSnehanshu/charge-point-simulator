require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const ChargePoint = require('./chargepoint');

// Express housekeeping
const port = process.env.PORT || 4300;
const app = express();
app.listen(port, () => console.log(`App listening on port ${port}...`));
app.set('view engine', 'pug');
app.set('views', './src/views');
app.use(helmet());
app.use('/static', express.static('./src/static'));

// Actual routes
app.get('/', function (req, res) {
    res.render('index');
});

app.get('/cp/:serial', async function (req, res) {
    var cp = await ChargePoint(req.params.serial);
    res.render('cp', cp);
});

// Finally, the 404 handler
app.all('*', function (req, res) {
    res.status(404).render('404');
});
