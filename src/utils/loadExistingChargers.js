const fs = require('fs');
const path = require('path');
const ChargePoint = require('../classes/chargepoint');

const cpfileroot = path.join(__dirname, '../..', 'charge-points');

module.exports = async function (io) {
    let chargepoints = {};
    let json_files = fs.readdirSync(cpfileroot).filter(f => f.endsWith('.json'));
    let promises = json_files.map(f => ChargePoint(f.split('.')[0], io));
    let loaded_chargepoints = await Promise.all(promises);
    loaded_chargepoints.forEach(cp => chargepoints[cp.serialno] = cp);
    return chargepoints;
}
