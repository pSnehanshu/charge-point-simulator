const express = require('express');
const ChargePoint = require('./chargepoint');
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
