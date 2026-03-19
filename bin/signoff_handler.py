import json
import urllib.request
import urllib.error
import ssl
import splunk.rest as rest
import splunk.clilib.cli_common as cli


class SignoffHandler(rest.BaseRestHandler):

    def handle_POST(self):
        try:
            # 1. Parse hostname and date_of_job from browser request
            payload = json.loads(self.request["payload"])
            hostname = payload.get("hostname", "").strip()
            compliance_review_type = payload.get(
                "compliance_review_type", ""
            ).strip()
            device = payload.get("device", "").strip()
            department = payload.get("department", "")
            group = payload.get("group", "")
            date_of_job = payload.get("date_of_job", "").strip()

            if not hostname or not date_of_job:
                self._send_error(400, "Missing hostname or date_of_job")
                return

            # 2. Get reviewer from Splunk session — never from browser
            reviewer = self._get_current_user()

            # 3. Read HEC config from app.conf — never exposed to browser
            hec_token, hec_url = self._get_hec_config()

            # 4. Build signoff event
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)

            event = {
                "sourcetype": "user_audit_signoff",
                "index": "automation_local_user_group_audit",
                "event": {
                    "event_type": "audit_signoff",
                    "hostname": hostname,
                    "date_of_job": date_of_job,
                    "compliance_review_type": compliance_review_type,
                    "device": device,
                    "department": department,
                    "group": group,
                    "reviewed_by": reviewer,
                    "reviewed_at": now.isoformat(),
                    "audit_year": str(now.year),
                    "remarks": "Reviewed via dashboard by " + reviewer,
                    "audit_source": "compliance_audit_app",
                },
            }

            # 5. POST to HEC internally using urllib (no external dependencies)
            body = json.dumps(event).encode("utf-8")
            req = urllib.request.Request(
                hec_url,
                data=body,
                headers={
                    "Authorization": "Splunk " + hec_token,
                    "Content-Type": "application/json",
                },
            )
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            urllib.request.urlopen(req, context=ctx, timeout=10)
            self._send_json(200, {"status": "ok", "reviewer": reviewer})

        except Exception as e:
            self._send_error(500, str(e))

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _get_hec_config(self):
        cfg = cli.getConfStanza("app", "hec_config")
        return cfg["token"], cfg["url"]

    def _get_current_user(self):
        response, content = rest.simpleRequest(
            "/services/authentication/current-context",
            sessionKey=self.sessionKey,
            getargs={"output_mode": "json"},
        )
        data = json.loads(content)
        return data["entry"][0]["content"]["username"]

    def _send_json(self, status, body):
        self.response.setStatus(status)
        self.response.setHeader("Content-Type", "application/json")
        self.response.write(json.dumps(body))

    def _send_error(self, status, message):
        self._send_json(status, {"status": "error", "message": message})
