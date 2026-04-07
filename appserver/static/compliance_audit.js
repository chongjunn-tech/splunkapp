// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/searchmanager",
    "app/compliance_account_review/audit_config",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc, SearchManager, CONFIG) {

    var tokens       = mvc.Components.getInstance("default");
    var selected     = {};
    var selectedMeta = {};  // key -> { compliance_review_type, device, department, group, date_of_job_raw }
    var PAGE_SIZE    = CONFIG.ui.pageSize || 10;
    var currentPage  = 1;
    var allRows      = [];

    var COLS = [
        { key: "date_of_job",            label: "Date of Job" },
        { key: "hostname",               label: "Host" },
        { key: "device",                 label: "Device" },
        { key: "department",             label: "Department" },
        { key: "group",                  label: "Group" },
        { key: "additional_users",       label: "Additional Users" },
        { key: "missing_users",          label: "Missing Users" },
        { key: "locked_accounts",        label: "Locked" },
        { key: "expired_accounts",       label: "Expired" },
        { key: "interactive_accounts",   label: "Interactive" },
        { key: "baseline_accounts",      label: "Baseline Accounts" },
        { key: "reviewed_by_info",       label: "Reviewed By" },
        { key: "review_date_info",       label: "Review Date" }
    ];

    function escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g,  "&lt;")
            .replace(/>/g,  "&gt;")
            .replace(/"/g,  "&quot;");
    }

    // ── Action bar ──────────────────────────────────────────────────────────
    function updateActionBar() {
        var bar     = document.getElementById("audit-action-bar");
        var btn     = document.getElementById("review-btn");
        var counter = document.getElementById("audit-selected-count");
        if (!bar || !btn || !counter) return;

        var count = Object.keys(selected).filter(function(k) { return selected[k]; }).length;
        counter.textContent = count + " host" + (count !== 1 ? "s" : "") + " selected";
        bar.style.display   = "block";

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

    // ── Pagination ──────────────────────────────────────────────────────────
    function totalPages() {
        return Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    }

    function renderPager() {
        var pager = document.getElementById("audit-pager");
        if (!pager) return;

        var total = totalPages();
        var start = (currentPage - 1) * PAGE_SIZE + 1;
        var end   = Math.min(currentPage * PAGE_SIZE, allRows.length);

        var html = "<span class='pager-info'>" + start + "–" + end + " of " + allRows.length + "</span>";
        html += "<button class='pager-btn' id='pager-first' " + (currentPage === 1     ? "disabled" : "") + ">«</button>";
        html += "<button class='pager-btn' id='pager-prev'  " + (currentPage === 1     ? "disabled" : "") + ">‹</button>";

        var winStart = Math.max(1, currentPage - 2);
        var winEnd   = Math.min(total, winStart + 4);
        winStart     = Math.max(1, winEnd - 4);

        for (var p = winStart; p <= winEnd; p++) {
            html += "<button class='pager-btn pager-num" + (p === currentPage ? " pager-active" : "") +
                    "' data-page='" + p + "'>" + p + "</button>";
        }

        html += "<button class='pager-btn' id='pager-next' " + (currentPage === total  ? "disabled" : "") + ">›</button>";
        html += "<button class='pager-btn' id='pager-last' " + (currentPage === total  ? "disabled" : "") + ">»</button>";
        pager.innerHTML = html;

        pager.addEventListener("click", function(e) {
            var btn = e.target.closest(".pager-btn");
            if (!btn || btn.disabled) return;
            var id = btn.id;
            var pg = parseInt(btn.getAttribute("data-page"), 10);
            if      (id === "pager-first") currentPage = 1;
            else if (id === "pager-prev")  currentPage = Math.max(1, currentPage - 1);
            else if (id === "pager-next")  currentPage = Math.min(totalPages(), currentPage + 1);
            else if (id === "pager-last")  currentPage = totalPages();
            else if (!isNaN(pg))           currentPage = pg;
            renderPage();
        });
    }

    function renderPage() {
        var start    = (currentPage - 1) * PAGE_SIZE;
        var pageRows = allRows.slice(start, start + PAGE_SIZE);
        renderTableRows(pageRows);
        renderPager();
    }

    // ── Table renderer ──────────────────────────────────────────────────────
    function renderTableRows(rows) {
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
            var host       = row["hostname"]               || "";
            var jobDate    = row["date_of_job"]            || "";   // SGT display string
            var jobDateRaw = row["date_of_job_raw"]        || "";   // raw UTC value for joining/signoff
            var reviewType = row["compliance_review_type"] || "";
            var device     = row["device"]                 || "";
            var department = row["department"]             || "";
            var group      = row["group"]                  || "";

            // Unique key uses raw date + device + reviewType to avoid collisions
            // when the same hostname runs on multiple devices or review types
            var uniqueKey = host + "|" + jobDateRaw + "|" + reviewType + "|" + device;

            var isReviewed = row["reviewed_by_info"] && row["reviewed_by_info"] !== "-";
            var checked    = selected[uniqueKey] ? "checked" : "";
            var rowClass   = isReviewed ? "reviewed" : "";

            html += "<tr class='" + rowClass + "'>";
            html += "<td><input type='checkbox' class='row-chk'"
                + " data-host='"         + escHtml(host)       + "'"
                + " data-date='"         + escHtml(jobDate)     + "'"
                + " data-date-raw='"     + escHtml(jobDateRaw)  + "'"
                + " data-review-type='"  + escHtml(reviewType)  + "'"
                + " data-device='"       + escHtml(device)      + "'"
                + " data-department='"   + escHtml(department)  + "'"
                + " data-group='"        + escHtml(group)        + "'"
                + " " + checked + "></td>";

            COLS.forEach(function(c) {
                html += "<td>" + escHtml(row[c.key] || "-") + "</td>";
            });
            html += "</tr>";
        });

        html += "</tbody></table>";
        container.innerHTML = html;

        // Event delegation — one listener handles all checkboxes
        container.addEventListener("change", function(e) {
            if (e.target && e.target.classList.contains("row-chk")) {
                var key = e.target.getAttribute("data-host")        + "|"
                        + e.target.getAttribute("data-date-raw")    + "|"
                        + e.target.getAttribute("data-review-type") + "|"
                        + e.target.getAttribute("data-device");

                selected[key]     = e.target.checked;
                selectedMeta[key] = {
                    compliance_review_type: e.target.getAttribute("data-review-type"),
                    device:                 e.target.getAttribute("data-device"),
                    department:             e.target.getAttribute("data-department"),
                    group:                  e.target.getAttribute("data-group"),
                    date_of_job_raw:        e.target.getAttribute("data-date-raw")
                };
                updateActionBar();
            }

            if (e.target && e.target.id === "chk-all") {
                document.querySelectorAll(".row-chk").forEach(function(b) {
                    var key = b.getAttribute("data-host")        + "|"
                            + b.getAttribute("data-date-raw")    + "|"
                            + b.getAttribute("data-review-type") + "|"
                            + b.getAttribute("data-device");

                    b.checked         = e.target.checked;
                    selected[key]     = e.target.checked;
                    selectedMeta[key] = {
                        compliance_review_type: b.getAttribute("data-review-type"),
                        device:                 b.getAttribute("data-device"),
                        department:             b.getAttribute("data-department"),
                        group:                  b.getAttribute("data-group"),
                        date_of_job_raw:        b.getAttribute("data-date-raw")
                    };
                });
                updateActionBar();
            }
        });

        updateActionBar();
    }

    function renderTable(rows) {
        allRows     = rows || [];
        currentPage = 1;
        renderPage();
    }

    // ── Search ──────────────────────────────────────────────────────────────
    var status = document.getElementById("audit-search-status");

    function runAuditSearch() {
        showFeedback("Loading audit data...", "loading");

        var reviewType  = tokens.get("service_catalog") || "user";
        var filterYear  = tokens.get("filter_year")    || "*";
        var filterMonth = tokens.get("filter_month")   || "*";
        var dept       = tokens.get("filter_dept")     || "*";
        var host       = tokens.get("filter_host")     || "*";
        var device     = tokens.get("filter_device")   || "*";
        var group      = tokens.get("filter_group")    || "*";

        var query = [
            'index=' + CONFIG.indexes.auditIndex + ' sourcetype="' + CONFIG.sourcetypes.auditLogs + '"',
            '| spath input=_raw path=hostname               output=hostname',
            '| spath input=_raw path=device                 output=device',
            '| spath input=_raw path=compliance_review_type output=compliance_review_type',
            // Keep raw UTC value for joining with signoff events
            '| spath input=_raw path=time                   output=date_of_job_raw',
            // Convert UTC → SGT (+8h) for display only
            '| eval date_of_job = strftime(strptime(date_of_job_raw, "%Y-%m-%dT%H:%M:%S") + 28800, "%d %b %Y %H:%M SGT")',
            '| spath input=_raw path=department             output=department',
            '| spath input=_raw path=group                  output=group',
            '| spath input=_raw path=additional_users{}     output=additional_users_mv',
            '| spath input=_raw path=missing_users{}        output=missing_users_mv',
            '| spath input=_raw path=locked_accounts{}      output=locked_accounts_mv',
            '| spath input=_raw path=expired_accounts{}     output=expired_accounts_mv',
            '| spath input=_raw path=interactive_accounts{} output=interactive_accounts_mv',
            '| spath input=_raw path=baseline_accounts{}    output=baseline_accounts_mv',
            '| where compliance_review_type="' + reviewType + '"'
                + ' AND (device="'     + device + '" OR "' + device + '"="*")'
                + ' AND (hostname="'   + host   + '" OR "' + host   + '"="*")'
                + ' AND (department="' + dept   + '" OR "' + dept   + '"="*")'
                + ' AND (group="'      + group  + '" OR "' + group  + '"="*")'
                + ' AND (substr(date_of_job_raw, 1, 4)="' + filterYear  + '" OR "' + filterYear  + '"="*")'
                + ' AND (substr(date_of_job_raw, 6, 2)="' + filterMonth + '" OR "' + filterMonth + '"="*")',
            '| eval additional_users     = if(isnull(mvjoin(additional_users_mv,     ", ")) OR mvjoin(additional_users_mv,     ", ")="", "-", mvjoin(additional_users_mv,     ", "))',
            '| eval missing_users        = if(isnull(mvjoin(missing_users_mv,        ", ")) OR mvjoin(missing_users_mv,        ", ")="", "-", mvjoin(missing_users_mv,        ", "))',
            '| eval locked_accounts      = if(isnull(mvjoin(locked_accounts_mv,      ", ")) OR mvjoin(locked_accounts_mv,      ", ")="", "-", mvjoin(locked_accounts_mv,      ", "))',
            '| eval expired_accounts     = if(isnull(mvjoin(expired_accounts_mv,     ", ")) OR mvjoin(expired_accounts_mv,     ", ")="", "-", mvjoin(expired_accounts_mv,     ", "))',
            '| eval interactive_accounts = if(isnull(mvjoin(interactive_accounts_mv, ", ")) OR mvjoin(interactive_accounts_mv, ", ")="", "-", mvjoin(interactive_accounts_mv, ", "))',
            '| eval baseline_accounts    = if(isnull(mvjoin(baseline_accounts_mv,    ", ")) OR mvjoin(baseline_accounts_mv,    ", ")="", "-", mvjoin(baseline_accounts_mv,    ", "))',
            // Join on raw date + hostname + device + review_type so the key always matches
            // (date_of_job in signoff events is stored as the raw UTC value)
            '| join type=left hostname date_of_job_raw device compliance_review_type [',
            '    search index=automation_local_user_group_audit sourcetype="user_audit_signoff" event_type="audit_signoff"',
            '    | rename date_of_job as date_of_job_raw',
            '    | sort - _time',
            '    | dedup hostname date_of_job_raw device compliance_review_type',
            '    | eval reviewed_by_info = reviewed_by',
            '    | eval review_date_info = strftime(_time, "%d %b %Y %H:%M SGT")',
            '    | table hostname date_of_job_raw device compliance_review_type reviewed_by_info review_date_info',
            '  ]',
            '| eval reviewed_by_info = coalesce(reviewed_by_info, "-")',
            '| eval review_date_info = coalesce(review_date_info, "-")',
            '| dedup hostname date_of_job_raw device compliance_review_type',
            '| sort department hostname -date_of_job_raw',
            '| table hostname device compliance_review_type date_of_job date_of_job_raw department group additional_users missing_users locked_accounts expired_accounts interactive_accounts baseline_accounts reviewed_by_info review_date_info'
        ].join(" ");

        var sm = new SearchManager({
            id:        "audit-search-" + Date.now(),
            search:    query,
            preview:   false,
            cache:     false,
            autostart: true
        }, { tokens: false });

        sm.on("search:done", function() {
            var results = sm.data("results", { offset: 0 });
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
                showFeedback("Audit data loaded", "success");
            });
        });

        sm.on("search:error", function(err) {
            if (status) status.textContent = "Search error.";
            console.error("Audit search error:", err);
        });
    }

    // ── Feedback ────────────────────────────────────────────────────────────
    function showFeedback(message, statusType) {
        var el = document.getElementById("audit-search-status");
        if (!el) return;

        var styles = {
            success: "#166534",
            error:   "#991b1b",
            warning: "#92400e",
            info:    "#1d4ed8",
            loading: "#6b7280"
        };
        var icons = {
            success: "✔ ",
            error:   "✖ ",
            warning: "⚠ ",
            info:    "ℹ ",
            loading: "⏳ "
        };

        el.textContent = (icons[statusType] || "") + message;
        el.style.color   = styles[statusType] || styles.info;
        el.style.opacity = "1";

        if (statusType !== "loading") {
            setTimeout(function() {
                el.style.opacity = "0";
                setTimeout(function() { el.textContent = ""; }, 300);
            }, CONFIG.ui.refreshDelay);
        }
    }

    // ── Token listeners ─────────────────────────────────────────────────────
    runAuditSearch();
    tokens.on("change:service_catalog change:filter_year change:filter_month change:filter_device change:filter_dept change:filter_group change:filter_host", function() {
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

            btn.disabled = true;
            showFeedback("Submitting reviews...", "loading");

            // Get reviewer from Splunk session — never trust client-supplied value
            var envTokens = mvc.Components.getInstance("env");
            var reviewer  = envTokens.get("user") || "unknown";
            if (reviewer === "unknown") {
                try   { reviewer = Splunk.util.getCurrentUser(); }
                catch (e) { reviewer = "local_admin"; }
            }

            var service = mvc.createService();

            var promises = keys.map(function(key) {
                var parts         = key.split("|");
                var host          = parts[0];
                var jobDateRaw    = parts[1];   // raw UTC value — matches what's stored in index
                var rowReviewType = (selectedMeta[key] && selectedMeta[key].compliance_review_type) || "";
                var rowDevice     = (selectedMeta[key] && selectedMeta[key].device)                 || "";
                var rowDepartment = (selectedMeta[key] && selectedMeta[key].department)             || "";
                var rowGroup      = (selectedMeta[key] && selectedMeta[key].group)                  || "";

                return service.request(
                    "signoff",
                    "POST",
                    null,
                    null,
                    JSON.stringify({
                        hostname:               host,
                        date_of_job:            jobDateRaw,     // raw value so join works
                        compliance_review_type: rowReviewType,
                        device:                 rowDevice,
                        department:             rowDepartment,
                        group:                  rowGroup
                    }),
                    { "Content-Type": "application/json" },
                    null
                ).then(function(r) {
                    return typeof r === "string" ? JSON.parse(r) : r;
                });
            });

            Promise.all(promises)
                .then(function(results) {
                    var failed = results.filter(function(r) { return r.status !== "ok"; });
                    if (failed.length > 0) throw new Error(failed[0].message || "Unknown error");

                    btn.textContent      = "Mark Selected as Reviewed";
                    btn.disabled         = true;
                    btn.style.background = "#9ca3af";

                    // Show host (reviewType) in success message
                    var uniqueNames = Array.from(new Set(
                        keys.map(function(k) {
                            var p = k.split("|");
                            return p[0] + " (" + p[2] + ")";
                        })
                    ));

                    selected     = {};
                    selectedMeta = {};
                    updateActionBar();

                    showFeedback(
                        keys.length + " host(s) marked as reviewed by " + reviewer + ": " + uniqueNames.join(", "),
                        "success"
                    );

                    setTimeout(function() { runAuditSearch(); }, CONFIG.ui.refreshDelay);
                })
                .catch(function(err) {
                    console.error("Signoff error:", err);
                    showFeedback("Error: " + (err.message || "Unknown error"), "error");
                    btn.textContent      = "Mark Selected as Reviewed";
                    btn.disabled         = false;
                    btn.style.background = "#1d4ed8";
                    btn.style.opacity    = "1";
                });
        });
    }
});