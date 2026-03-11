// compliance_audit.js
require([
    "splunkjs/mvc",
    "splunkjs/mvc/simplexml/ready!"
], function(mvc) {

    var tokens = mvc.Components.getInstance("default");

    tokens.on("change:selected_host", function() {
        var host = tokens.get("selected_host") || "";
        var label = document.getElementById("review-host-label");
        if (label) label.textContent = host || "None";
    });

    var btn = document.getElementById("review-btn");
    if (btn) {
        btn.addEventListener("click", function() {
            var host = tokens.get("selected_host") || "";
            var feedback = document.getElementById("review-feedback");

            if (!host) {
                feedback.textContent = "Please click a row in the table first.";
                feedback.style.color = "#b45309";
                return;
            }

            btn.disabled = true;
            btn.textContent = "Submitting...";

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

            console.log("Reviewer name for event:", reviewer);

            var now = new Date();

            // We use the direct URL since your curl test proved it works.
            // Note: We use http instead of https to bypass the SSL 'Invalid Cert' error 
            // since this is a local test environment on your Mac.
            var url = "http://localhost:8088/services/collector/event";

            fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": "Splunk 94567e0d-0e2d-491f-ae98-95ce35320d86"
                },
                body: JSON.stringify({
                    sourcetype: "user_audit_signoff",
                    index:      "automation_local_user_group_audit",
                    event: {
                        event_type: "audit_signoff",
                        hostname:   host,
                        reviewed_by: reviewer,
                        reviewed_at: now.toISOString(),
                        decision:   "Approved"
                    }
                })
            })
            .then(function(response) {
                return response.json();
            })
            .then(function(data) {
                if (data && data.code === 0) {
                    feedback.textContent = "Success! Row Marked as Reviewed.";
                    feedback.style.color = "#166534";
                    btn.textContent = "Submitted";
                } else {
                    throw new Error(data.text || "HEC Error");
                }
            })
            .catch(function(err) {
                console.error("Audit Error:", err);
                // If it still fails, it's likely a CORS block. 
                feedback.textContent = "Check browser console for CORS/SSL block.";
                feedback.style.color = "#991b1b";
                btn.disabled = false;
                btn.textContent = "Try Again";
            });
        });
    }
});