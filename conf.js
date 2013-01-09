module.exports = {
  "google_analytics_id": null,
  "fqdn": "hn-weekly.spiffyte.ch"
};

try {
    var overrides = require("./conf_override.js");
    for(var override in overrides) {
        module.exports[override] = overrides[override];
    }
} catch(e) {}
