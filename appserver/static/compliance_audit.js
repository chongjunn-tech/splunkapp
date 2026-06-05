// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/searchmanager",
    "app/compliance_account_review/audit_config",
    "jquery",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc, SearchManager, CONFIG, $) {

    var tokens               = mvc.Components.getInstance("default");
    var selected             = {};
    var selectedMeta         = {};  // key -> { compliance_review_type, device, department, group, date_of_job_raw }
    var PAGE_SIZE            = CONFIG.ui.pageSize || 10;
    var currentPage          = 1;
    var allRows              = [];
    var currentSearchManager = null;
    var COLS                 = [];

    // ── Sync review_type_label on load in case service_catalog was restored from URL ──
    var LABEL_MAP = {
        user:    "Asset - Local User Review",
        group:   "Asset - Local Group Review",
        account: "Account - Access Review"
    };
    function syncLabel() {
        var cat = tokens.get("service_catalog") || "user";
        tokens.set("review_type_label", LABEL_MAP[cat] || LABEL_MAP["user"]);
    }
    syncLabel();
    tokens.on("change:service_catalog", syncLabel);

    // var COLS = [
    //     { key: "date_of_job",            label: "Date of Job" },
    //     { key: "asset_id",               label: "Host" },
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
    // ── Review type config ──────────────────────────────────────────────────────
    var REVIEW_CONFIG = {
        user: {
            cols: [
                { key: "date_of_job",                 label: "Date of Job" },
                { key: "job_id",                      label: "Job ID" },
                { key: "asset_id",                    label: "Asset ID" },
                { key: "device",                      label: "Device Type" },
                { key: "department",                  label: "Department" },
                { key: "group",                       label: "Group" },
                { key: "additional_users",            label: "Additional Users" },
                { key: "locked_accounts",             label: "Locked" },
                { key: "expired_accounts",            label: "Expired" },
                { key: "interactive_accounts",        label: "Interactive" },
                { key: "non_interactive_accounts",    label: "Non-Interactive" },
                { key: "password_violation_accounts", label: "Password Violation Accounts" },
                { key: "baseline_accounts",           label: "Baseline Accounts" },
                { key: "reviewed_by",                 label: "Reviewed By" },
                { key: "reviewed_at",                 label: "Review Date" },
                { key: "comments",                    label: "Comments", isComment: true }
            ],
            spathFields: [
                { path: "additional_users{}",            output: "additional_users_mv" },
                { path: "locked_accounts{}",             output: "locked_accounts_mv" },
                { path: "expired_accounts{}",            output: "expired_accounts_mv" },
                { path: "interactive_accounts{}",        output: "interactive_accounts_mv" },
                { path: "non_interactive_accounts{}",    output: "non_interactive_accounts_mv" },
                { path: "password_violation_accounts{}", output: "password_violation_accounts_mv" },
                { path: "baseline_accounts{}",           output: "baseline_accounts_mv" }
            ],
            mvEvals: [
                { field: "additional_users",            mv: "additional_users_mv" },
                { field: "locked_accounts",             mv: "locked_accounts_mv" },
                { field: "expired_accounts",            mv: "expired_accounts_mv" },
                { field: "interactive_accounts",        mv: "interactive_accounts_mv" },
                { field: "non_interactive_accounts",    mv: "non_interactive_accounts_mv" },
                { field: "password_violation_accounts", mv: "password_violation_accounts_mv" },
                { field: "baseline_accounts",           mv: "baseline_accounts_mv" }
            ],
            tableFields: "record_id asset_id device compliance_review_type date_of_job date_of_job_raw job_id department group additional_users locked_accounts expired_accounts interactive_accounts non_interactive_accounts password_violation_accounts baseline_accounts reviewed_by reviewed_at comments"
        },

        group: {
            cols: [
                { key: "date_of_job",       label: "Date of Job" },
                { key: "job_id",            label: "Job ID" },
                { key: "asset_id",          label: "Asset ID" },
                { key: "device",            label: "Device Type" },
                { key: "department",        label: "Department" },
                { key: "group",             label: "Group" },
                { key: "additional_groups", label: "Additional Groups" },
                { key: "wheel_groups",      label: "Wheel Groups" },
                { key: "baseline_groups",   label: "Baseline Groups" },
                { key: "reviewed_by",       label: "Reviewed By" },
                { key: "reviewed_at",       label: "Review Date" },
                { key: "comments",          label: "Comments", isComment: true }
            ],
            spathFields: [
                { path: "additional_groups{}", output: "additional_groups_mv" },
                { path: "wheel_groups{}",      output: "wheel_groups_mv" },
                { path: "baseline_groups{}",   output: "baseline_groups_mv" }
            ],
            mvEvals: [
                { field: "additional_groups", mv: "additional_groups_mv" },
                { field: "wheel_groups",      mv: "wheel_groups_mv" },
                { field: "baseline_groups",   mv: "baseline_groups_mv" }
            ],
            tableFields: "record_id asset_id device compliance_review_type date_of_job date_of_job_raw job_id department group additional_groups wheel_groups baseline_groups reviewed_by reviewed_at comments"
        },

        // Account audit — one row per account; dedup key includes account_name
        account: {
            perAccount: true,
            cols: [
                { key: "date_of_job",          label: "Date of Job" },
                { key: "job_id",               label: "Job ID" },
                { key: "asset_id",             label: "Asset ID" },
                { key: "device",               label: "Device Type" },
                { key: "department",           label: "Department" },
                { key: "group",                label: "Group" },
                { key: "account_name",         label: "Account Name" },
                { key: "account_type",         label: "Account Type" },
                { key: "account_origin",       label: "Account Origin" },
                { key: "account_status",       label: "Account Status" },
                { key: "role_name",            label: "Role Name" },
                { key: "role_scope",           label: "Role Scope" },
                { key: "last_login",           label: "Last Login" },
                { key: "custodian",            label: "Custodian" },
                { key: "custodian_designation", label: "Custodian Designation" },
                { key: "review_outcome",       label: "Review Outcome", isOutcome: true },
                { key: "reviewed_by",          label: "Reviewed By" },
                { key: "reviewed_at",          label: "Review Date" },
                { key: "comments",             label: "Comments", isComment: true }
            ],
            spathFields: [],
            mvEvals: [],
            tableFields: "record_id asset_id device compliance_review_type date_of_job date_of_job_raw job_id department group account_name account_type account_origin account_status role_name role_scope last_login custodian custodian_designation review_outcome reviewed_by reviewed_at comments"
        }
    };

    // ── Outcome selections for account_audit rows ────────────────────────────
    // key = record_id, value = "Retain" | "Revoke" | "Lock"
    var rowOutcomes = {};

    // ── Free-text comments per row ───────────────────────────────────────────
    // key = record_id, value = string
    var rowComments = {};

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

        // For account_audit: block if any selected row is missing an outcome
        var reviewType = tokens.get("service_catalog") || "user";
        var missingOutcome = false;
        if (reviewType === "account" && count > 0) {
            Object.keys(selected).forEach(function(k) {
                if (selected[k] && !rowOutcomes[k]) {
                    missingOutcome = true;
                }
            });
        }

        if (count > 0 && !missingOutcome) {
            btn.disabled         = false;
            btn.style.background = "#1d4ed8";
            btn.style.cursor     = "pointer";
            btn.style.opacity    = "1";
            btn.title            = "";
        } else {
            btn.disabled         = true;
            btn.style.background = "#9ca3af";
            btn.style.cursor     = "not-allowed";
            btn.style.opacity    = "0.7";
            btn.title            = missingOutcome
                ? "Set a Review Outcome for all selected rows before signing off"
                : "";
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
    }

    // ── Checkbox listener — registered once, not inside renderTableRows ──
    var containerEl = document.getElementById("audit-table-container");
    if (containerEl) {
        // Use 'input' for comment textareas — fires on every keystroke, not just on blur
        containerEl.addEventListener("input", function(e) {
            if (e.target && e.target.classList.contains("comment-input")) {
                rowComments[e.target.getAttribute("data-key")] = e.target.value;
            }
        });

        containerEl.addEventListener("change", function(e) {
            // ── Comment input fallback (blur) ──────────────────────────────────
            if (e.target && e.target.classList.contains("comment-input")) {
                rowComments[e.target.getAttribute("data-key")] = e.target.value;
                return;
            }

            // ── Outcome dropdown (account_audit only) ──────────────────────────
            if (e.target && e.target.classList.contains("outcome-select")) {
                var key = e.target.getAttribute("data-key");
                rowOutcomes[key] = e.target.value;
                updateActionBar();
                return;
            }

            if (e.target && e.target.classList.contains("row-chk")) {
                var key = e.target.getAttribute("data-key");  // record_id

                if (e.target.checked) {
                    selected[key]     = true;
                    selectedMeta[key] = {
                        record_id:              e.target.getAttribute("data-record-id"),
                        compliance_review_type: e.target.getAttribute("data-review-type"),
                        device:                 e.target.getAttribute("data-device"),
                        department:             e.target.getAttribute("data-department"),
                        group:                  e.target.getAttribute("data-group"),
                        date_of_job_raw:        e.target.getAttribute("data-date-raw"),
                        account_name:           e.target.getAttribute("data-account-name") || ""
                    };
                } else {
                    delete selected[key];
                    delete selectedMeta[key];
                }
                updateActionBar();
            }

            if (e.target && e.target.id === "chk-all") {
                document.querySelectorAll(".row-chk").forEach(function(b) {
                    var key = b.getAttribute("data-key");  // record_id

                    b.checked = e.target.checked;
                    if (e.target.checked) {
                        selected[key]     = true;
                        selectedMeta[key] = {
                            record_id:              b.getAttribute("data-record-id"),
                            compliance_review_type: b.getAttribute("data-review-type"),
                            device:                 b.getAttribute("data-device"),
                            department:             b.getAttribute("data-department"),
                            group:                  b.getAttribute("data-group"),
                            date_of_job_raw:        b.getAttribute("data-date-raw"),
                            account_name:           b.getAttribute("data-account-name") || ""
                        };
                    } else {
                        delete selected[key];
                        delete selectedMeta[key];
                    }
                });
                updateActionBar();
            }
        });
    }

    // ── Pager click — registered once, not inside renderPager ────────────
    var pagerEl = document.getElementById("audit-pager");
    if (pagerEl) {
        pagerEl.addEventListener("click", function(e) {
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

        // Horizontal scroll for wide schemas
        container.style.overflowX = "auto";
        container.style.width     = "100%";

        var isAccount  = (tokens.get("service_catalog") === "account");

        // Per-column min-widths — account uses tighter widths to fit all 19 cols on screen
        var COL_WIDTHS = isAccount ? {
            date_of_job:          "80px",
            job_id:               "80px",
            asset_id:             "80px",
            device:               "55px",
            department:           "75px",
            group:                "55px",
            account_name:         "80px",
            account_type:         "55px",
            account_origin:       "60px",
            account_status:       "55px",
            role_name:            "60px",
            role_scope:           "55px",
            last_login:           "80px",
            custodian:            "65px",
            custodian_designation: "70px",
            review_outcome:       "80px",
            reviewed_by:          "60px",
            reviewed_at:          "80px",
            comments:             "100px"
        } : {
            date_of_job:                 "90px",
            job_id:                      "90px",
            asset_id:                    "90px",
            device:                      "70px",
            department:                  "90px",
            group:                       "70px",
            reviewed_by:                 "70px",
            reviewed_at:                 "90px",
            comments:                    "90px",
            additional_users:            "100px",
            locked_accounts:             "70px",
            expired_accounts:            "70px",
            interactive_accounts:        "70px",
            non_interactive_accounts:    "90px",
            password_violation_accounts: "110px",
            baseline_accounts:           "90px",
            additional_groups:           "90px",
            wheel_groups:                "80px",
            baseline_groups:             "80px"
        };

        if (!rows || rows.length === 0) {
            var emptyHtml = "<table class='audit-table' style='min-width:100%;white-space:nowrap;border-collapse:collapse;'><thead><tr>";
            emptyHtml += "<th style='width:32px;min-width:32px;'></th>";
            COLS.forEach(function(c) {
                var w = COL_WIDTHS[c.key] || "100px";
                emptyHtml += "<th style='min-width:" + w + ";padding:6px 8px;'>" + c.label + "</th>";
            });
            emptyHtml += "</tr></thead><tbody></tbody></table>";
            container.innerHTML = emptyHtml;
            updateActionBar();
            return;
        }

        var html = "<table class='audit-table' style='min-width:100%;white-space:nowrap;border-collapse:collapse;'><thead><tr>";
        html += "<th style='width:32px;min-width:32px;'><input type='checkbox' id='chk-all' title='Select all'></th>";
        COLS.forEach(function(c) {
            var w = COL_WIDTHS[c.key] || "100px";
            html += "<th style='min-width:" + w + ";padding:6px 8px;'>" + c.label + "</th>";
        });
        html += "</tr></thead><tbody>";

        rows.forEach(function(row) {
            var recordId   = row["record_id"]              || "";
            var asset      = row["asset_id"]               || "";
            var jobDate    = row["date_of_job"]            || "";
            var jobDateRaw = row["date_of_job_raw"]        || "";
            var reviewType = row["compliance_review_type"] || "";
            var device     = row["device"]                 || "";
            var department = row["department"]             || "";
            var group      = row["group"]                  || "";
            var accountName = row["account_name"]          || "";

            // record_id is the unique key per row — no more multi-field composite keys
            var uniqueKey = recordId;

            var isReviewed = row["reviewed_by"] && row["reviewed_by"] !== "-";
            var checked    = selected[uniqueKey] ? "checked" : "";
            var rowClass   = row._pending ? "pending"
                           : isReviewed   ? "reviewed"
                           : "";

            html += "<tr class='" + rowClass + "'>";
            html += "<td><input type='checkbox' class='row-chk'"
                + " data-record-id='"    + escHtml(recordId)    + "'"
                + " data-asset='"         + escHtml(asset)        + "'"
                + " data-date='"         + escHtml(jobDate)     + "'"
                + " data-date-raw='"     + escHtml(jobDateRaw)  + "'"
                + " data-review-type='"  + escHtml(reviewType)  + "'"
                + " data-device='"       + escHtml(device)      + "'"
                + " data-department='"   + escHtml(department)  + "'"
                + " data-group='"        + escHtml(group)       + "'"
                + " data-account-name='" + escHtml(accountName) + "'"
                + " data-key='"          + escHtml(uniqueKey)   + "'"
                + " " + checked + "></td>";

            COLS.forEach(function(c) {
                if (c.isComment) {
                    // Always editable — pre-fill with saved comment from last signoff or current input
                    var currentComment = rowComments[uniqueKey] !== undefined
                        ? rowComments[uniqueKey]
                        : (row["comments"] && row["comments"] !== "-" ? row["comments"] : "");
                    html += "<td>"
                        + "<textarea class='comment-input' data-key='" + escHtml(uniqueKey) + "'"
                        + " rows='1'"
                        + " style='font-size:11px;padding:2px 3px;border:1px solid #d1d5db;border-radius:3px;width:90px;resize:vertical;'"
                        + " placeholder='Comments...'>"
                        + escHtml(currentComment)
                        + "</textarea>"
                        + "</td>";
                } else if (c.isOutcome) {
                    var currentOutcome = rowOutcomes[uniqueKey] || row["review_outcome"] || "";
                    html += "<td>"
                        + "<select class='outcome-select' data-key='" + escHtml(uniqueKey) + "'"
                        + " style='font-size:11px;padding:2px 3px;border:1px solid #d1d5db;border-radius:3px;width:80px;"
                        + (currentOutcome === "" ? "border-color:#ef4444;" : "") + "'>"
                        + "<option value='' " + (currentOutcome === "" ? "selected" : "") + ">-- Select --</option>"
                        + "<option value='Retain' " + (currentOutcome === "Retain" ? "selected" : "") + ">Retain</option>"
                        + "<option value='Revoke' " + (currentOutcome === "Revoke" ? "selected" : "") + ">Revoke</option>"
                        + "<option value='Lock' "   + (currentOutcome === "Lock"   ? "selected" : "") + ">Lock</option>"
                        + "</select>"
                        + "</td>";
                } else {
                    html += "<td>" + escHtml(row[c.key] || "-") + "</td>";
                }
            });
            html += "</tr>";
        });

        html += "</tbody></table>";
        container.innerHTML = html;
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

        // Free memory from previous result set immediately
        allRows      = [];
        selected     = {};
        selectedMeta = {};
        rowOutcomes  = {};
        rowComments  = {};

        var reviewType  = tokens.get("service_catalog") || "user";
        var filterYear  = tokens.get("filter_year")    || "*";
        var filterMonth = tokens.get("filter_month")   || "*";
        var dept        = tokens.get("filter_dept")    || "*";
        var asset       = tokens.get("filter_asset")    || "*";
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

        // Convert last_login to SGT for account audit
        if (cfg.perAccount) {
            evalLines.push('| eval last_login = if(isnotnull(last_login) AND last_login!="", strftime(strptime(last_login, "%Y-%m-%dT%H:%M:%S") + 28800, "%Y-%m-%d %H:%M"), last_login)');
        }

        // Join and dedup on record_id — unique per audit row, eliminates multi-field key complexity
        var dedupFields  = "record_id";
        var joinFields   = "record_id";
        var signoffDedup = "record_id";

        var query = [
                'index=' + CONFIG.indexes.auditIndex + ' event_type="audit" earliest=-3y latest=now',
                '| spath input=_raw path=time output=date_of_job_raw',
                '| eval asset_id = coalesce(asset_id, hostname)',
                '| eval date_of_job = strftime(strptime(date_of_job_raw, "%Y-%m-%dT%H:%M:%S") + 28800, "%Y-%m-%d %H:%M")',
            ]
            .concat(spathLines)
            .concat([
                '| where compliance_review_type="' + reviewType + '"'
                    + ' AND (device="'     + device + '" OR "' + device + '"="*")'
                    + ' AND (asset_id="'   + asset  + '" OR "' + asset  + '"="*")'
                    + ' AND (department="' + dept   + '" OR "' + dept   + '"="*")'
                    + ' AND (group="'      + group  + '" OR "' + group  + '"="*")'
                    + ' AND (substr(date_of_job_raw, 1, 4)="' + filterYear  + '" OR "' + filterYear  + '"="*")'
                    + ' AND (substr(date_of_job_raw, 6, 2)="' + filterMonth + '" OR "' + filterMonth + '"="*")',
            ])
            .concat(evalLines)
            .concat([
                '| sort 0 asset_id device department group' + (cfg.perAccount ? ' account_name' : '') + ' -date_of_job_raw',
                '| dedup record_id',
                '| join type=left max=1 record_id [',
                '    search index=automation_local_user_group_audit sourcetype="user_audit_signoff" event_type="audit_signoff" earliest=-3y latest=now',
                '    | sort 0 - reviewed_at',
                '    | dedup record_id',
                '    | eval reviewed_at = strftime(strptime(reviewed_at, "%Y-%m-%dT%H:%M:%S.%f+00:00") + 28800, "%Y-%m-%d %H:%M")',
                '    | eval reviewed_at = if(isnull(reviewed_at) OR reviewed_at="", strftime(strptime(reviewed_at, "%Y-%m-%dT%H:%M:%S+00:00") + 28800, "%Y-%m-%d %H:%M"), reviewed_at)',
                '    | table record_id reviewed_by reviewed_at comments' + (cfg.perAccount ? ' review_outcome' : ''),
                '  ]',
                '| eval reviewed_by  = coalesce(reviewed_by, "-")',
                '| eval reviewed_at  = coalesce(reviewed_at, "-")',
                '| eval comments     = coalesce(comments, "-")',
                (cfg.perAccount ? '| eval review_outcome = coalesce(review_outcome, "")' : ''),
                '| where (',
                '  ("' + reviewer + '"="all")',
                '  OR ("' + reviewer + '"="*" AND reviewed_by!="-" AND isnotnull(reviewed_by))',
                '  OR ("' + reviewer + '"="unreviewed" AND (reviewed_by="-" OR isnull(reviewed_by)))',
                '  OR ("' + reviewer + '"!="all" AND "' + reviewer + '"!="*" AND "' + reviewer + '"!="unreviewed" AND reviewed_by="' + reviewer + '")',
                ')',
                '| sort 0 department asset_id' + (cfg.perAccount ? ' account_name' : '') + ' -date_of_job_raw',
                '| table ' + cfg.tableFields
            ]).filter(Boolean).join(" ");

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
                // Only keep fields needed for display and sign-off — discard the rest
                var keepFields = {};
                var cfg2 = REVIEW_CONFIG[tokens.get("service_catalog") || "user"] || REVIEW_CONFIG["user"];
                cfg2.cols.forEach(function(c) { keepFields[c.key] = true; });
                ["record_id","asset_id","date_of_job_raw","compliance_review_type","device","department","group"].forEach(function(f) {
                    keepFields[f] = true;
                });

                var rows = d.rows.map(function(row) {
                    var obj = {};
                    d.fields.forEach(function(f, i) {
                        if (keepFields[f]) obj[f] = (row[i] !== null && row[i] !== undefined) ? row[i] : "";
                    });
                    return obj;
                });

                // Pre-populate rowOutcomes and rowComments from saved values returned by the join
                rows.forEach(function(row) {
                    if (row.record_id) {
                        if (cfg2.perAccount && row.review_outcome && row.review_outcome !== "-") {
                            rowOutcomes[row.record_id] = row.review_outcome;
                        }
                        if (row.comments && row.comments !== "-" && rowComments[row.record_id] === undefined) {
                            rowComments[row.record_id] = row.comments;
                        }
                    }
                });

                renderTable(rows, restorePage);
                showFeedback("Audit data loaded (" + rows.length + " rows)", "success");
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
                var val;
                if (c.isOutcome) {
                    val = row[c.key] || rowOutcomes[row["record_id"]] || "-";
                } else {
                    val = row[c.key] || "-";
                }
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
        var f_host     = tokens.get("filter_asset")     || "all";
        var f_reviewer = tokens.get("filter_reviewer") || "all";
        var _now       = new Date();
        var timestamp  = _now.toISOString().slice(0, 10)
                       + "T" + String(_now.getHours()).padStart(2, "0")
                       + String(_now.getMinutes()).padStart(2, "0")
                       + String(_now.getSeconds()).padStart(2, "0");
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
        "filter_device", "filter_dept", "filter_group", "filter_asset", "filter_reviewer"
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
    tokens.on("change:service_catalog change:filter_year change:filter_month change:filter_device change:filter_dept change:filter_group change:filter_asset change:filter_reviewer", function() {
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
            // ── Flush any textarea values currently in the DOM into rowComments ──
            // Protects against the case where the user hasn't triggered 'input' yet
            document.querySelectorAll(".comment-input").forEach(function(el) {
                var k = el.getAttribute("data-key");
                if (k) rowComments[k] = el.value;
            });

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
            var reviewDateSGT = sgtTime.getUTCFullYear()
                              + "-" + String(sgtTime.getUTCMonth() + 1).padStart(2, "0")
                              + "-" + day
                              + " " + String(sgtTime.getUTCHours()).padStart(2, "0")
                              + ":" + String(sgtTime.getUTCMinutes()).padStart(2, "0");

            // ── Set all selected rows to pending (spinner) ──────────────────────
            keys.forEach(function(key) {
                allRows.forEach(function(row) {
                    if (row.record_id === key) { row._pending = true; }
                });
            });

            // Snapshot meta before clearing — requests fire after clear
            var metaSnapshot = {};
            keys.forEach(function(key) {
                metaSnapshot[key] = selectedMeta[key] || {};
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
                var meta    = metaSnapshot[key];
                var fullRow = null;
                allRows.forEach(function(row) {
                    if (row.record_id === key) { fullRow = row; }
                });

                // Build the base signoff payload
                var isAccountType = (meta.compliance_review_type === "account");
                var signoffPayload = {
                    record_id:              key,
                    compliance_review_type: meta.compliance_review_type || "",
                    device:                 meta.device                 || "",
                    department:             meta.department              || "",
                    group:                  meta.group                  || "",
                    comments:               rowComments[key]            || ""
                };
                // Only include review_outcome for account audit
                if (isAccountType) {
                    signoffPayload.review_outcome = rowOutcomes[key] || "";
                }

                // Merge all row fields into the payload so the signoff event is self-contained
                if (fullRow) {
                    var reviewType2 = meta.compliance_review_type || "";
                    var cfg2 = REVIEW_CONFIG[reviewType2] || REVIEW_CONFIG["user"];
                    cfg2.cols.forEach(function(c) {
                        if (c.isOutcome) return;  // handled separately via rowOutcomes
                        if (c.isComment) return;   // handled separately via rowComments
                        if (["device","department","group"].indexOf(c.key) !== -1) return;
                        signoffPayload[c.key] = fullRow[c.key] || "";
                    });
                    signoffPayload.record_id = fullRow.record_id || key;
                    signoffPayload.job_id    = fullRow.job_id    || "";
                    signoffPayload.asset_id  = fullRow.asset_id  || "";
                    signoffPayload.date_of_job = fullRow.date_of_job_raw || "";
                }

                return service.request(
                    "signoff",
                    "POST",
                    null,
                    null,
                    JSON.stringify(signoffPayload),
                    { "Content-Type": "application/json" },
                    null
                )
                .then(function(r) {
                    var result = typeof r === "string" ? JSON.parse(r) : r;
                    allRows.forEach(function(row) {
                        if (row.record_id === key) {
                            row._pending = false;
                            if (result.status === "ok") {
                                row.reviewed_by    = result.reviewer || reviewer;
                                row.reviewed_at    = reviewDateSGT;
                                row.comments       = rowComments[key] || "";
                                row.review_outcome = rowOutcomes[key] || "";
                            } else {
                                failed.push(key);
                            }
                        }
                    });
                    renderPage();
                    return result;
                })
                .catch(function(err) {
                    allRows.forEach(function(row) {
                        if (row.record_id === key) { row._pending = false; }
                    });
                    failed.push(key);
                    renderPage();
                    console.error("Signoff error for record_id=" + key + ":", err);
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
                        keys.length + " asset(s) marked as reviewed by " + reviewer,
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