// Default configuration that's stored in the git repo
// Do not change
// Create conf_overrides.js and assign the appropriate values to these variables there
process.env.hnweekly_google_analytics_id = null;
process.env.hnweekly_fqdn = "hn-weekly.spiffyte.ch";
process.env.hnweekly_postgres_host = "localhost";
process.env.hnweekly_postgres_port = 5432;
process.env.hnweekly_postgres_user = null;
process.env.hnweekly_postgres_password = null;
process.env.hnweekly_postgres_db = "hnweekly";
process.env.hnweekly_contact_address = "fake@example.com";

try {
    require("./conf_override.js");
} catch(e) {}
