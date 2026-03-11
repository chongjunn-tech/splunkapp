// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/searchmanager",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc, SearchManager) {

    var tokens   = mvc.Components.getInstance("default");
    var selected = {};

    var COLS = [
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
            var isReviewed = row["reviewed_by_info"] && row["reviewed_by_info"] !== "-";
            var checked    = selected[host] ? "checked" : "";
            var rowClass   = isReviewed ? "reviewed" : "";

            html += "<tr class='" + rowClass + "'>";
            html += "<td><input type='checkbox' class='row-chk' data-host='" + escHtml(host) + "' " + checked + "></td>";
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
                selected[e.target.getAttribute("data-host")] = e.target.checked;
                updateActionBar();
            }
            if (e.target && e.target.id === "chk-all") {
                document.querySelectorAll(".row-chk").forEach(function(b) {
                    b.checked = e.target.checked;
                    selected[b.getAttribute("data-host")] = e.target.checked;
                });
                updateActionBar();
            }
        });

        updateActionBar();
    }

    // ── Search ──────────────────────────────────────────────────────────────
    var status = document.getElementById("audit-search-status");

    function runAuditSearch() {
        if (status) status.textContent = "Loading...";

        var dept = tokens.get("filter_dept") || "*";
        var host = tokens.get("filter_host") || "*";

        var query = [
            'index=automation_local_user_group_audit sourcetype="custom:automation_local_user_group_audit:logs"',
            '| spath input=_raw path=hostname               output=hostname',
            '| spath input=_raw path=department             output=department',
            '| spath input=_raw path=additional_users{}     output=additional_users_mv',
            '| spath input=_raw path=missing_users{}        output=missing_users_mv',
            '| spath input=_raw path=locked_accounts{}      output=locked_accounts_mv',
            '| spath input=_raw path=expired_accounts{}     output=expired_accounts_mv',
            '| spath input=_raw path=interactive_accounts{} output=interactive_accounts_mv',
            '| spath input=_raw path=baseline_accounts{}    output=baseline_accounts_mv',
            '| where (hostname="' + host + '" OR "' + host + '"="*")',
            '    AND (department="' + dept + '" OR "' + dept + '"="*")',
            '| eval additional_users     = if(isnull(mvjoin(additional_users_mv,    ", ")) OR mvjoin(additional_users_mv,    ", ")="", "-", mvjoin(additional_users_mv,    ", "))',
            '| eval missing_users        = if(isnull(mvjoin(missing_users_mv,       ", ")) OR mvjoin(missing_users_mv,       ", ")="", "-", mvjoin(missing_users_mv,       ", "))',
            '| eval locked_accounts      = if(isnull(mvjoin(locked_accounts_mv,     ", ")) OR mvjoin(locked_accounts_mv,     ", ")="", "-", mvjoin(locked_accounts_mv,     ", "))',
            '| eval expired_accounts     = if(isnull(mvjoin(expired_accounts_mv,    ", ")) OR mvjoin(expired_accounts_mv,    ", ")="", "-", mvjoin(expired_accounts_mv,    ", "))',
            '| eval interactive_accounts = if(isnull(mvjoin(interactive_accounts_mv,", ")) OR mvjoin(interactive_accounts_mv,", ")="", "-", mvjoin(interactive_accounts_mv,", "))',
            '| eval baseline_accounts    = if(isnull(mvjoin(baseline_accounts_mv,   ", ")) OR mvjoin(baseline_accounts_mv,   ", ")="", "-", mvjoin(baseline_accounts_mv,   ", "))',
            '| join type=left hostname [',
            '    search index=automation_local_user_group_audit sourcetype="user_audit_signoff" event_type="audit_signoff"',
            '    | sort - _time | dedup hostname',
            '    | eval reviewed_by_info = reviewed_by',
            '    | eval review_date_info = strftime(_time, "%d/%m/%Y %H:%M")',
            '    | table hostname reviewed_by_info review_date_info',
            '  ]',
            '| eval reviewed_by_info = coalesce(reviewed_by_info, "-")',
            '| eval review_date_info = coalesce(review_date_info, "-")',
            '| dedup hostname',
            '| sort department hostname',
            '| table hostname department additional_users missing_users locked_accounts expired_accounts interactive_accounts baseline_accounts reviewed_by_info review_date_info'
        ].join(" ");

        var sm = new SearchManager({
            id:        "audit-search-" + Date.now(),
            search:    query,
            preview:   false,
            cache:     false,
            autostart: true
        }, { tokens: false });

        sm.on("search:done", function() {
            var results = sm.data("results", { count: 1000, offset: 0 });
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
            var feedback = document.getElementById("review-feedback");
            var hosts    = Object.keys(selected).filter(function(k) { return selected[k]; });
            if (hosts.length === 0) return;

            btn.disabled         = true;
            // btn.textContent      = "Submitting...";
            btn.style.background = "#9ca3af";
            feedback.textContent = "";

            var reviewer = "unknown";
            try { reviewer = Splunk.util.getCurrentUser() || "unknown"; } catch(e) {}

            var now = new Date();
            var promises = hosts.map(function(host) {
                return fetch("http://localhost:8088/services/collector/event", {
                    method: "POST",
                    headers: {
                        "Authorization": "Splunk 94567e0d-0e2d-491f-ae98-95ce35320d86"
                    },
                    body: JSON.stringify({
                        sourcetype: "user_audit_signoff",
                        index:      "automation_local_user_group_audit",
                        event: {
                            event_type:   "audit_signoff",
                            hostname:     host,
                            reviewed_by:  reviewer,
                            reviewed_at:  now.toISOString(),
                            audit_year:   String(now.getFullYear()),
                            decision:     "Approved",
                            remarks:      "Reviewed via dashboard by " + reviewer,
                            audit_source: "compliance_audit_app"
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

                    selected = {};
                    updateActionBar();

                    feedback.textContent = hosts.length + " host(s) marked as reviewed by " + reviewer + ".";
                    feedback.style.color = "#166534";

                    setTimeout(function() { runAuditSearch(); }, 2000);
                })
                .catch(function(err) {
                    feedback.textContent = "Error: " + err.message;
                    feedback.style.color = "#991b1b";
                    btn.textContent      = "Mark Selected as Reviewed";
                    btn.disabled         = false;
                    btn.style.background = "#1d4ed8";
                    btn.style.opacity    = "1";
                });
        });
    }
});