const express = require('express');
const ChargePoint = require('./classes/chargepoint');
const router = express.Router();
module.exports = router;

/* Structure of Charge point storage
{
    <serialNo>: <cpInstance>
}
*/

router.get('/', async function (req, res) {
    if (global.chargepoints[req.serialno]) {
        var cp = global.chargepoints[req.serialno];
    } else {
        var cp = await ChargePoint(req.serialno);
        global.chargepoints[req.serialno] = cp;
    }
    
    res.render('cp', cp);
});

router.post('/uid-upload', function (req, res) {
    if (! req.files.uids) {
        return res.sendStatus(400);
    }
    var file = req.files.uids;
    var data = Buffer.from(file.data).toString();

    res.send('<pre>' + data + '</pre>');
});
