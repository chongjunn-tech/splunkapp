// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/searchmanager",
    "app/compliance_account_review/audit_config",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc, SearchManager,CONFIG) {

    var tokens   = mvc.Components.getInstance("default");
    var selected = {};

    var COLS = [
        { key: "date_of_job",                  label: "Date of Job" },
        { key: "hostname",              label: "Host" },
        { key: "department",            label: "Department" },
        { key: "additional_users",      label: "Additional Users" },
        { key: "missing_users",         label: "Missing Users" },
        { key: "locked_accounts",       label: "Locked" },
        { key: "expired_accounts",      label: "Expired" },
        { key: "interactive_accounts",  label: "Interactive" },
        { key: "baseline_accounts",     label: "Baseline Accounts" },
        { key: "reviewed_by_info",      label: "Reviewed By" },
        { key: "review_date_info",      label: "Review Date" }
    ];

    function escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function updateActionBar() {
        var bar     = document.getElementById("audit-action-bar");
        var btn     = document.getElementById("review-btn");
        var counter = document.getElementById("audit-selected-count");
        if (!bar || !btn || !counter) return;

        var count = Object.keys(selected).filter(function(k) { return selected[k]; }).length;
        counter.textContent = count + " host" + (count > 1 ? "s" : "") + " selected";

        bar.style.display = "block";


        if (count > 0) {
            btn.disabled         = false;
            btn.style.background = "#1d4ed8";
            btn.style.cursor     = "pointer";
            btn.style.opacity    = "1";
        } else {
            btn.disabled         = true;
            btn.style.background = "#9ca3af";
            btn.style.cursor     = "not-allowed";
            btn.style.opacity    = "0.7";
        }
    }

    function renderTable(rows) {
        var container = document.getElementById("audit-table-container");
        if (!container) return;

        if (!rows || rows.length === 0) {
            container.innerHTML = "<p style='padding:12px;color:#6b7280;font-size:13px;'>No results found.</p>";
            updateActionBar();
            return;
        }

        var html = "<table class='audit-table'><thead><tr>";
        html += "<th style='width:32px;'><input type='checkbox' id='chk-all' title='Select all'></th>";
        COLS.forEach(function(c) { html += "<th>" + c.label + "</th>"; });
        html += "</tr></thead><tbody>";

        rows.forEach(function(row) {
            var host       = row["hostname"] || "";

            var jobDate = row["date_of_job"] || "";
            // Create a unique key to identify this specific row
            var uniqueKey = host + "|" + jobDate;
            
            var isReviewed = row["reviewed_by_info"] && row["reviewed_by_info"] !== "-";
            var checked    = selected[uniqueKey] ? "checked" : "";
            var rowClass   = isReviewed ? "reviewed" : "";

            html += "<tr class='" + rowClass + "'>";
            html += "<td><input type='checkbox' class='row-chk' data-host='" + escHtml(host) + "' data-date='" + escHtml(jobDate) + "' " + checked + "></td>";
            COLS.forEach(function(c) {
                html += "<td>" + escHtml(row[c.key] || "-") + "</td>";
            });
            html += "</tr>";
        });

        html += "</tbody></table>";
        container.innerHTML = html;

        // Event delegation — one listener on the container handles all checkboxes
        container.addEventListener("change", function(e) {
            if (e.target && e.target.classList.contains("row-chk")) {
                // Create the unique key from both data attributes
                var key = e.target.getAttribute("data-host") + "|" + e.target.getAttribute("data-date");
                selected[key] = e.target.checked;
                updateActionBar();
            }
            if (e.target && e.target.id === "chk-all") {
                document.querySelectorAll(".row-chk").forEach(function(b) {
                    var key = b.getAttribute("data-host") + "|" + b.getAttribute("data-date");
                    b.checked = e.target.checked;
                    selected[key] = e.target.checked;
                });
                updateActionBar();
            }
        });

        updateActionBar();
    }

    // ── Search ──────────────────────────────────────────────────────────────
    var status = document.getElementById("audit-search-status");

    function runAuditSearch() {
        showFeedback("Audit data loaded", "success");
        // if (status) status.innerHTML = "<span class='spinner'></span> Loading...";

        var dept = tokens.get("filter_dept") || "*";
        var host = tokens.get("filter_host") || "*";

       var query = [
            'index=' + CONFIG.indexes.auditIndex + ' sourcetype="' + CONFIG.sourcetypes.auditLogs + '"',
            '| spath input=_raw path=hostname               output=hostname',
            '| spath input=_raw path=time                   output=date_of_job',
            '| spath input=_raw path=department             output=department',
            '| spath input=_raw path=additional_users{}     output=additional_users_mv',
            '| spath input=_raw path=missing_users{}        output=missing_users_mv',
            '| spath input=_raw path=locked_accounts{}      output=locked_accounts_mv',
            '| spath input=_raw path=expired_accounts{}     output=expired_accounts_mv',
            '| spath input=_raw path=interactive_accounts{} output=interactive_accounts_mv',
            '| spath input=_raw path=baseline_accounts{}    output=baseline_accounts_mv',
            '| where (hostname="' + host + '" OR "' + host + '"="*") AND (department="' + dept + '" OR "' + dept + '"="*")',
            '| eval additional_users     = if(isnull(mvjoin(additional_users_mv, ", ")) OR mvjoin(additional_users_mv, ", ")="", "-", mvjoin(additional_users_mv, ", "))',
            '| eval missing_users        = if(isnull(mvjoin(missing_users_mv,    ", ")) OR mvjoin(missing_users_mv,    ", ")="", "-", mvjoin(missing_users_mv,    ", "))',
            '| eval locked_accounts      = if(isnull(mvjoin(locked_accounts_mv,  ", ")) OR mvjoin(locked_accounts_mv,  ", ")="", "-", mvjoin(locked_accounts_mv,  ", "))',
            '| eval expired_accounts     = if(isnull(mvjoin(expired_accounts_mv, ", ")) OR mvjoin(expired_accounts_mv, ", ")="", "-", mvjoin(expired_accounts_mv, ", "))',
            '| eval interactive_accounts = if(isnull(mvjoin(interactive_accounts_mv,", ")) OR mvjoin(interactive_accounts_mv,", ")="", "-", mvjoin(interactive_accounts_mv,", "))',
            '| eval baseline_accounts    = if(isnull(mvjoin(baseline_accounts_mv, ", ")) OR mvjoin(baseline_accounts_mv, ", ")="", "-", mvjoin(baseline_accounts_mv, ", "))',
            // FIXED: Added space before bracket and corrected subquery spath
            '| join type=left hostname date_of_job [',
            '    search index=automation_local_user_group_audit sourcetype="user_audit_signoff" event_type="audit_signoff"',
            '    | spath input=_raw path=hostname    output=hostname',
            '    | spath input=_raw path=date_of_job output=date_of_job', 
            '    | sort - _time',
            '    | dedup hostname date_of_job',
            '    | eval reviewed_by_info = reviewed_by',
            '    | eval review_date_info = strftime(_time, "%d/%m/%Y %H:%M")',
            '    | table hostname date_of_job reviewed_by_info review_date_info',
            '  ]',
            '| eval reviewed_by_info = coalesce(reviewed_by_info, "-")',
            '| eval review_date_info = coalesce(review_date_info, "-")',
            '| dedup hostname date_of_job',
            '| sort department hostname -date_of_job',
            // Latest date_of_job only:
            '| dedup hostname',
            '| table hostname date_of_job department additional_users missing_users locked_accounts expired_accounts interactive_accounts baseline_accounts reviewed_by_info review_date_info'
        ].join(" ");

        var sm = new SearchManager({
            id:        "audit-search-" + Date.now(),
            search:    query,
            preview:   false,
            cache:     false,
            autostart: true
        }, { tokens: false });

        sm.on("search:done", function() {
            var results = sm.data("results", { 
                count: CONFIG.ui.maxResults, 
                offset: 0 
            });
            results.on("data", function() {
                var d = results.data();
                if (!d || !d.rows || !d.fields) {
                    if (status) status.textContent = "";
                    renderTable([]);
                    return;
                }
                var rows = d.rows.map(function(row) {
                    var obj = {};
                    d.fields.forEach(function(f, i) { obj[f] = row[i]; });
                    return obj;
                });
                if (status) status.textContent = "";
                renderTable(rows);
            });
        });

        sm.on("search:error", function(err) {
            if (status) status.textContent = "Search error.";
            console.error("Audit search error:", err);
        });
    }
    // function showFeedback(message, color) {
    //     var feedback = document.getElementById("review-feedback");
    //     if (!feedback) return;

    //     feedback.textContent = message;
    //     feedback.style.color = color;
    //     feedback.style.opacity = "1";

    //     setTimeout(function() {
    //         feedback.style.opacity = "0";
    //         setTimeout(function() {
    //             feedback.textContent = "";
    //         }, 300); // allow fade-out
    //     }, 1000); 
    // }
    function showFeedback(message, statusType) {

    var status = document.getElementById("audit-search-status");
    if (!status) return;

    var styles = {
        success: "#166534",
        error: "#991b1b",
        warning: "#92400e",
        info: "#1d4ed8",
        loading: "#6b7280"
    };

    var icons = {
        success: "✔ ",
        error: "✖ ",
        warning: "⚠ ",
        info: "ℹ ",
        loading: "⏳ "
    };

    status.textContent = (icons[statusType] || "") + message;
    status.style.color = styles[statusType] || styles.info;
    status.style.opacity = "1";

    if (statusType !== "loading") {
        setTimeout(function () {
            status.style.opacity = "0";

            setTimeout(function () {
                status.textContent = "";
            }, 300);

        }, CONFIG.ui.refreshDelay);
    }
}

    runAuditSearch();
    tokens.on("change:filter_dept change:filter_host", function() {
        runAuditSearch();
    });

    // ── Review button ───────────────────────────────────────────────────────
    var btn = document.getElementById("review-btn");
    if (btn) {
        btn.disabled         = true;
        btn.style.background = "#9ca3af";
        btn.style.cursor     = "not-allowed";
        btn.style.opacity    = "0.7";

        btn.addEventListener("click", function() {
            var keys = Object.keys(selected).filter(function(k) { return selected[k]; });
            if (keys.length === 0) return;

            btn.disabled         = true;
            showFeedback("Submitting reviews...", "loading");
   

            var envTokens = mvc.Components.getInstance("env");
            var reviewer  = envTokens.get("user") || "unknown";
                
            // Fallback if env tokens are empty (rare)
            if (reviewer === "unknown") {
                try {
                    reviewer = Splunk.util.getCurrentUser();
                } catch(e) {
                    reviewer = "local_admin"; // Final fallback for local testing
                }
            }

            var now = new Date();
            var promises = keys.map(function(key) {
                var parts = key.split("|");
                var host = parts[0];
                var jobDate = parts[1];

                return fetch(CONFIG.splunk.hecUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": "Splunk " + CONFIG.splunk.hecToken
                    },
                    body: JSON.stringify({
                        sourcetype: "user_audit_signoff",
                        index:      "automation_local_user_group_audit",
                        event: {
                            event_type:   "audit_signoff",
                            hostname:     host,
                            date_of_job:  jobDate,
                            reviewed_by:  reviewer,
                            reviewed_at:  now.toISOString(),
                            audit_year:   String(now.getFullYear()),
                            remarks:      "Reviewed via dashboard by " + reviewer,
                            audit_source: "compliance_audit_app",
                            
                        }
                    })
                }).then(function(r) { return r.json(); });
            });

            Promise.all(promises)
                .then(function(results) {
                    var failed = results.filter(function(r) { return r.code !== 0; });
                    if (failed.length > 0) throw new Error(failed[0].text);

                    btn.textContent      = "Mark Selected as Reviewed";
                    btn.disabled         = true;
                    btn.style.background = "#9ca3af";

                    // Create a clean list of hostnames for the UI message
                    var hostNames = keys.map(function(k) { return k.split("|")[0]; });
                    // Remove duplicates for the display message
                    var uniqueNames = Array.from(new Set(hostNames));

                    selected = {};
                    updateActionBar();

                    showFeedback(
                        keys.length + " host(s) marked as reviewed by " + reviewer + ".: " + uniqueNames.join(", "),
                        "success");

                    setTimeout(function() { runAuditSearch(); }, CONFIG.ui.refreshDelay);
                })
                .catch(function(err) {
                    showFeedback(
                        "Error: " + err.message,
                        "error");
                    btn.textContent      = "Mark Selected as Reviewed";
                    btn.disabled         = false;
                    btn.style.background = "#1d4ed8";
                    btn.style.opacity    = "1";
                });
        });
    }
});