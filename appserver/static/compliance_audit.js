// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/searchmanager",
    "app/compliance_account_review/audit_config",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc, SearchManager, CONFIG) {

    var tokens               = mvc.Components.getInstance("default");
    var selected             = {};
    var selectedMeta         = {};  // key -> { compliance_review_type, device, department, group, date_of_job_raw }
    var PAGE_SIZE            = CONFIG.ui.pageSize || 10;
    var currentPage          = 1;
    var allRows              = [];
    var currentSearchManager = null;
    var COLS                 = [];

    // var COLS = [
    //     { key: "date_of_job",            label: "Date of Job" },
    //     { key: "hostname",               label: "Host" },
    //     { key: "device",                 label: "Device" },
    //     { key: "department",             label: "Department" },
    //     { key: "group",                  label: "Group" },
    //     { key: "additional_users",       label: "Additional Users" },
    //     { key: "missing_users",          label: "Missing Users" },
    //     { key: "locked_accounts",        label: "Locked" },
    //     { key: "expired_accounts",       label: "Expired" },
    //     { key: "interactive_accounts",   label: "Interactive" },
    //     { key: "baseline_accounts",      label: "Baseline Accounts" },
    //     { key: "reviewed_by_info",       label: "Reviewed By" },
    //     { key: "review_date_info",       label: "Review Date" }
    // ];
    // ── Catalog config map ──────────────────────────────────────────────────────
 // ── Review type config ──────────────────────────────────────────────────────
    var REVIEW_CONFIG = {
        user: {
            cols: [
                { key: "date_of_job",          label: "Date of Job" },
                { key: "hostname",             label: "Host" },
                { key: "device",               label: "Device" },
                { key: "department",           label: "Department" },
                { key: "group",                label: "Group" },
                { key: "additional_users",     label: "Additional Users" },
                { key: "missing_users",        label: "Missing Users" },
                { key: "locked_accounts",      label: "Locked" },
                { key: "expired_accounts",     label: "Expired" },
                { key: "interactive_accounts", label: "Interactive" },
                { key: "baseline_accounts",    label: "Baseline Accounts" },
                { key: "reviewed_by_info",     label: "Reviewed By" },
                { key: "review_date_info",     label: "Review Date" }
            ],
            // extra spath fields to extract from _raw
            spathFields: [
                { path: "additional_users{}",     output: "additional_users_mv" },
                { path: "missing_users{}",        output: "missing_users_mv" },
                { path: "locked_accounts{}",      output: "locked_accounts_mv" },
                { path: "expired_accounts{}",     output: "expired_accounts_mv" },
                { path: "interactive_accounts{}", output: "interactive_accounts_mv" },
                { path: "baseline_accounts{}",    output: "baseline_accounts_mv" }
            ],
            // mvjoin evals to produce display columns
            mvEvals: [
                { field: "additional_users",     mv: "additional_users_mv" },
                { field: "missing_users",        mv: "missing_users_mv" },
                { field: "locked_accounts",      mv: "locked_accounts_mv" },
                { field: "expired_accounts",     mv: "expired_accounts_mv" },
                { field: "interactive_accounts", mv: "interactive_accounts_mv" },
                { field: "baseline_accounts",    mv: "baseline_accounts_mv" }
            ],
            // fields in the final | table clause
            tableFields: "hostname device compliance_review_type date_of_job date_of_job_raw department group additional_users missing_users locked_accounts expired_accounts interactive_accounts baseline_accounts reviewed_by_info review_date_info"
        },

        group: {
            cols: [
                { key: "date_of_job",      label: "Date of Job" },
                { key: "hostname",         label: "Host" },
                { key: "device",           label: "Device" },
                { key: "department",       label: "Department" },
                { key: "group",            label: "Group" },
                { key: "additional_groups",     label: "Additional Groups" },
                { key: "missing_groups",     label: "Missing Groups" },
                { key: "wheel_groups",     label: "Wheel Groups" },
                { key: "baseline_groups",     label: "Baseline Groups" },
                { key: "reviewed_by_info", label: "Reviewed By" },
                { key: "review_date_info", label: "Review Date" }
            ],
            spathFields: [
                { path: "additional_groups{}", output: "additional_groups_mv" },
                { path: "missing_groups{}", output: "missing_groups_mv" },
                { path: "wheel_groups{}", output: "wheel_groups_mv" },
                { path: "baseline_groups{}", output: "baseline_groups_mv" },
            ],
            mvEvals: [
                { field: "additional_groups", mv: "additional_groups_mv" },
                { field: "missing_groups", mv: "missing_groups_mv" },
                { field: "wheel_groups", mv: "wheel_groups_mv" },
                { field: "baseline_groups", mv: "baseline_groups_mv" },
            ],
            tableFields: "hostname device compliance_review_type date_of_job date_of_job_raw department group additional_groups missing_groups wheel_groups baseline_groups reviewed_by_info review_date_info"
        }
    };

    function escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g,  "&lt;")
            .replace(/>/g,  "&gt;")
            .replace(/"/g,  "&quot;");
    }

    // ── Loading skeleton ────────────────────────────────────────────────────
    function showLoading() {
        var container = document.getElementById("audit-table-container");
        var pager     = document.getElementById("audit-pager");
        if (container) {
            var html = "<table class='audit-table'><thead><tr>";
            html += "<th style='width:32px;'></th>";
            COLS.forEach(function(c) { html += "<th>" + c.label + "</th>"; });
            html += "</tr></thead><tbody>";
            html += "<tr><td colspan='" + (COLS.length + 1) + "' style='text-align:center;padding:32px;color:#6b7280;font-size:13px;'>";
            html += "&#9203; Loading audit data...</td></tr>";
            html += "</tbody></table>";
            container.innerHTML = html;
        }
        if (pager) pager.innerHTML = "";
    }

    // ── Action bar ──────────────────────────────────────────────────────────
    function updateActionBar() {
        var bar     = document.getElementById("audit-action-bar");
        var btn     = document.getElementById("review-btn");
        var counter = document.getElementById("audit-selected-count");
        if (!bar || !btn || !counter) return;

        var count = Object.keys(selected).filter(function(k) { return selected[k]; }).length;
        counter.textContent = count + " row(s)" + " selected";
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

        // Hide pager when no rows
        if (allRows.length === 0) {
            pager.innerHTML = "";
            return;
        }

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
            saveFilters();
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
            // Show header with empty body rather than a text message
            var emptyHtml = "<table class='audit-table'><thead><tr>";
            emptyHtml += "<th style='width:32px;'></th>";
            COLS.forEach(function(c) { emptyHtml += "<th>" + c.label + "</th>"; });
            emptyHtml += "</tr></thead><tbody></tbody></table>";
            container.innerHTML = emptyHtml;
            updateActionBar();
            return;
        }

        var html = "<table class='audit-table'><thead><tr>";
        html += "<th style='width:32px;'><input type='checkbox' id='chk-all' title='Select all'></th>";
        COLS.forEach(function(c) {
            var style = c.key === "hostname"? ` style='min-width:${CONFIG.ui.hostnameWidth}px;'`: "";
            html += "<th" + style + ">" + c.label + "</th>";
        });
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
            var rowClass   = row._pending ? "pending"
                           : isReviewed   ? "reviewed"
                           : "";

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

    function renderTable(rows, restorePage) {
        allRows     = rows || [];
        currentPage = (restorePage && restorePage <= totalPages()) ? restorePage : 1;
        // Always clear the loading status text when table renders
        var statusEl = document.getElementById("audit-search-status");
        if (statusEl) { statusEl.textContent = ""; statusEl.style.opacity = "0"; }
        renderPage();
    }

    // ── Search ──────────────────────────────────────────────────────────────
    var status = document.getElementById("audit-search-status");

    function runAuditSearch(restorePage) {
        // Cancel and destroy previous search before starting a new one
        if (currentSearchManager) {
            currentSearchManager.cancel();
            currentSearchManager.dispose();
            currentSearchManager = null;
        }

        var reviewType  = tokens.get("service_catalog") || "user";
        var filterYear  = tokens.get("filter_year")    || "*";
        var filterMonth = tokens.get("filter_month")   || "*";
        var dept        = tokens.get("filter_dept")    || "*";
        var host        = tokens.get("filter_host")    || "*";
        var device      = tokens.get("filter_device")  || "*";
        var group       = tokens.get("filter_group")   || "*";
        var reviewer    = tokens.get("filter_reviewer") || "all";

        var cfg  = REVIEW_CONFIG[reviewType] || REVIEW_CONFIG["user"];
        COLS     = cfg.cols;

        // Show header + loading row immediately before search fires
        showLoading();

            // ── Build dynamic spath + eval blocks ───────────────────────────────────
        var spathLines = cfg.spathFields.map(function(f) {
            return '| spath input=_raw path=' + f.path + ' output=' + f.output;
        });

        var evalLines = cfg.mvEvals.map(function(f) {
            return '| eval ' + f.field + ' = if(isnull(mvjoin(' + f.mv + ', ", ")) OR mvjoin(' + f.mv + ', ", ")="", "-", mvjoin(' + f.mv + ', ", "))';
        });

        var query = [
                'index=' + CONFIG.indexes.auditIndex + ' sourcetype="' + CONFIG.sourcetypes.auditLogs + '" earliest=-3y latest=now',
                '| spath input=_raw path=time output=date_of_job_raw',

                '| eval date_of_job = strftime(strptime(date_of_job_raw, "%Y-%m-%dT%H:%M:%S") + 28800, "%d %b %Y %H:%M SGT")',

            ]
            .concat(spathLines)
            .concat([
                '| where compliance_review_type="' + reviewType + '"'
                    + ' AND (device="'     + device + '" OR "' + device + '"="*")'
                    + ' AND (hostname="'   + host   + '" OR "' + host   + '"="*")'
                    + ' AND (department="' + dept   + '" OR "' + dept   + '"="*")'
                    + ' AND (group="'      + group  + '" OR "' + group  + '"="*")'
                    + ' AND (substr(date_of_job_raw, 1, 4)="' + filterYear  + '" OR "' + filterYear  + '"="*")'
                    + ' AND (substr(date_of_job_raw, 6, 2)="' + filterMonth + '" OR "' + filterMonth + '"="*")',
            ])
            .concat(evalLines)
            .concat([
                '| join type=left hostname date_of_job_raw device compliance_review_type [',
                '    search index=automation_local_user_group_audit sourcetype="user_audit_signoff" event_type="audit_signoff" earliest=-3y latest=now',
                '    | rename date_of_job as date_of_job_raw',
                '    | sort - _time',
                '    | dedup hostname date_of_job_raw device compliance_review_type',
                '    | eval reviewed_by_info = reviewed_by',
                '    | eval review_date_info = strftime(_time, "%d %b %Y %H:%M SGT")',
                '    | table hostname date_of_job_raw device compliance_review_type reviewed_by_info review_date_info',
                '  ]',
                '| eval reviewed_by_info = coalesce(reviewed_by_info, "-")',
                '| eval review_date_info = coalesce(review_date_info, "-")',
                '| where (',
                '  ("' + reviewer + '"="all")',
                '  OR ("' + reviewer + '"="*" AND reviewed_by_info!="-" AND isnotnull(reviewed_by_info))',
                '  OR ("' + reviewer + '"="unreviewed" AND (reviewed_by_info="-" OR isnull(reviewed_by_info)))',
                '  OR ("' + reviewer + '"!="all" AND "' + reviewer + '"!="*" AND "' + reviewer + '"!="unreviewed" AND reviewed_by_info="' + reviewer + '")',
                ')',
                '| dedup hostname date_of_job_raw device compliance_review_type',
                '| sort department hostname -date_of_job_raw',
                '| table ' + cfg.tableFields
            ]).join(" ");

        currentSearchManager = new SearchManager({
            id:        "audit-search-main",
            search:    query,
            preview:   false,
            cache:     true,
            autostart: true
        }, { tokens: false });

        currentSearchManager.on("search:done", function() {
            var results = currentSearchManager.data("results", { offset: 0, count: 0 });
            var dataFired = false;

            results.on("data", function() {
                dataFired = true;
                var d = results.data();
                if (!d || !d.rows || !d.fields || d.rows.length === 0) {
                    renderTable([]);
                    return;
                }
                var rows = d.rows.map(function(row) {
                    var obj = {};
                    d.fields.forEach(function(f, i) { obj[f] = row[i]; });
                    return obj;
                });
                renderTable(rows, restorePage);
                showFeedback("Audit data loaded", "success");
            });

            // If data event never fires (zero results), clear loading state
            setTimeout(function() {
                if (!dataFired) {
                    renderTable([]);
                }
            }, 500);
        });

        currentSearchManager.on("search:error", function(err) {
            showFeedback("Search error — check Splunk logs.", "error");
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

    // ── Export CSV ──────────────────────────────────────────────────────────
    function exportToCSV() {
        if (!allRows || allRows.length === 0) {
            showFeedback("No data to export.", "warning");
            return;
        }

        // Build header row from current COLS
        var headers = ["#"].concat(COLS.map(function(c) { return c.label; }));
        var csvRows = [headers.join(",")];

        allRows.forEach(function(row, i) {
            var values = [i + 1].concat(COLS.map(function(c) {
                var val = row[c.key] || "-";
                // Wrap in quotes and escape any existing quotes
                return '"' + String(val).replace(/"/g, '""') + '"';
            }));
            csvRows.push(values.join(","));
        });

        var csvContent = csvRows.join("\n");
        var blob       = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        var url        = URL.createObjectURL(blob);
        var link       = document.createElement("a");

        // Build filename from all current filters
        var f_catalog  = tokens.get("service_catalog") || "all";
        var f_year     = tokens.get("filter_year")     || "all";
        var f_month    = tokens.get("filter_month")    || "all";
        var f_device   = tokens.get("filter_device")   || "all";
        var f_dept     = tokens.get("filter_dept")     || "all";
        var f_group    = tokens.get("filter_group")    || "all";
        var f_host     = tokens.get("filter_host")     || "all";
        var f_reviewer = tokens.get("filter_reviewer") || "all";
        var timestamp  = new Date().toISOString().slice(0, 10);
        var filename   = [
            "compliance_audit",
            f_catalog, f_year, f_month, f_device, f_dept, f_group, f_host, f_reviewer,
            timestamp
        ].join("_").replace(/\*/g, "all") + ".csv";

        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showFeedback("Exported " + allRows.length + " rows to CSV.", "success");
    }

    // ── Filter persistence via URL params ──────────────────────────────────
    // Splunk natively reads form.* URL params and sets tokens before any JS
    // or XML init runs — so this approach survives page refresh reliably.
    var FILTER_KEYS = [
        "service_catalog", "filter_year", "filter_month",
        "filter_device", "filter_dept", "filter_group", "filter_host", "filter_reviewer"
    ];

    function saveFilters() {
        var params = {};
        FILTER_KEYS.forEach(function(key) {
            var val = tokens.get(key);
            if (val) params["form." + key] = val;
        });
        params["form.audit_page"] = currentPage;

        var queryString = Object.keys(params).map(function(k) {
            return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        }).join("&");

        // Update URL without reloading the page
        window.history.replaceState(null, "", window.location.pathname + "?" + queryString);
    }

    function getSavedPage() {
        var params = new URLSearchParams(window.location.search);
        return parseInt(params.get("form.audit_page"), 10) || 1;
    }

    // ── Token listeners ─────────────────────────────────────────────────────
    var savedPage = getSavedPage();
    runAuditSearch(savedPage);
    tokens.on("change:service_catalog change:filter_year change:filter_month change:filter_device change:filter_dept change:filter_group change:filter_host change:filter_reviewer", function() {
        saveFilters();
        runAuditSearch();
    });

    // ── Export button ───────────────────────────────────────────────────────
    var exportBtn = document.getElementById("export-btn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportToCSV);
    }

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

            // ── Compute SGT timestamp once for all rows ─────────────────────────
            var now           = new Date();
            var sgtTime       = new Date(now.getTime() + 8 * 60 * 60 * 1000);
            var day           = String(sgtTime.getUTCDate()).padStart(2, "0");
            var monthNames    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            var reviewDateSGT = day + " " + monthNames[sgtTime.getUTCMonth()] + " " + sgtTime.getUTCFullYear()
                              + " " + String(sgtTime.getUTCHours()).padStart(2, "0")
                              + ":" + String(sgtTime.getUTCMinutes()).padStart(2, "0") + " SGT";

            // ── Set all selected rows to pending (spinner) ──────────────────────
            keys.forEach(function(key) {
                var parts = key.split("|");
                allRows.forEach(function(row) {
                    if (
                        row.hostname               === parts[0] &&
                        row.date_of_job_raw        === parts[1] &&
                        row.compliance_review_type === parts[2] &&
                        row.device                 === parts[3]
                    ) {
                        row._pending = true;
                    }
                });
            });

            // Clear selection immediately so checkboxes uncheck during spinner
            selected     = {};
            selectedMeta = {};
            updateActionBar();

            renderPage();  // show spinner on selected rows immediately

            var service = mvc.createService();
            var failed  = [];

            // ── Fire one request per row — each resolves independently ──────────
            var promises = keys.map(function(key) {
                var parts = key.split("|");

                return service.request(
                    "signoff",
                    "POST",
                    null,
                    null,
                    JSON.stringify({
                        hostname:               parts[0],
                        date_of_job:            parts[1],
                        compliance_review_type: (selectedMeta[key] && selectedMeta[key].compliance_review_type) || "",
                        device:                 (selectedMeta[key] && selectedMeta[key].device)                 || "",
                        department:             (selectedMeta[key] && selectedMeta[key].department)             || "",
                        group:                  (selectedMeta[key] && selectedMeta[key].group)                  || ""
                    }),
                    { "Content-Type": "application/json" },
                    null
                )
                .then(function(r) {
                    var result = typeof r === "string" ? JSON.parse(r) : r;

                    // This row responded — update it immediately
                    allRows.forEach(function(row) {
                        if (
                            row.hostname               === parts[0] &&
                            row.date_of_job_raw        === parts[1] &&
                            row.compliance_review_type === parts[2] &&
                            row.device                 === parts[3]
                        ) {
                            row._pending = false;  // stop spinner for this row
                            if (result.status === "ok") {
                                row.reviewed_by_info = reviewer;
                                row.review_date_info = reviewDateSGT;
                            } else {
                                failed.push(key);
                            }
                        }
                    });
                    renderPage();  // re-render immediately for this row
                    return result;
                })
                .catch(function(err) {
                    // This individual row failed
                    allRows.forEach(function(row) {
                        if (
                            row.hostname               === parts[0] &&
                            row.date_of_job_raw        === parts[1] &&
                            row.compliance_review_type === parts[2] &&
                            row.device                 === parts[3]
                        ) {
                            row._pending = false;  // stop spinner
                        }
                    });
                    failed.push(key);
                    renderPage();
                    console.error("Signoff error for " + parts[0] + ":", err);
                    return { status: "error" };
                });
            });

            // ── Wait for all to settle then show final summary ──────────────────
            Promise.allSettled(promises).then(function() {
                if (failed.length === 0) {
                    // All succeeded
                    btn.disabled         = true;
                    btn.style.background = "#9ca3af";
                    showFeedback(
                        keys.length + " host(s) marked as reviewed by " + reviewer,
                        "success"
                    );
                } else if (failed.length === keys.length) {
                    // All failed
                    btn.disabled         = false;
                    btn.style.background = "#1d4ed8";
                    btn.style.opacity    = "1";
                    showFeedback("All signoffs failed — please try again.", "error");
                } else {
                    // Partial — some succeeded some failed
                    btn.disabled         = false;
                    btn.style.background = "#1d4ed8";
                    btn.style.opacity    = "1";
                    showFeedback(
                        (keys.length - failed.length) + " succeeded, " + failed.length + " failed — retry the failed rows.",
                        "warning"
                    );
                }
            });
        });
    }
});