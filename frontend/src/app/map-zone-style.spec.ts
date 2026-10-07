import assert from 'node:assert/strict';
import {assessedZoneFill,riskColors} from './map-zone-style.js';
assert.equal(assessedZoneFill({zone_color:'#123456',active_report_count:0,assessed_risk_level:'Low'}).fillOpacity,0);
assert.equal(assessedZoneFill({zone_color:'#123456'}).fillOpacity,0);
assert.deepEqual(assessedZoneFill({zone_color:'#123456',active_report_count:'2',assessed_risk_level:'High'}),{fillColor:riskColors.High,fillOpacity:.24});
assert.equal(assessedZoneFill({active_report_count:2,assessed_risk_level:'Unknown'}).fillOpacity,0);
assert.equal(assessedZoneFill({active_report_count:'NaN',assessed_risk_level:'High'}).fillOpacity,0);
console.log('Zone fills: no reports/missing/unknown risk remain transparent; validated flood risk supplies fill color.');
