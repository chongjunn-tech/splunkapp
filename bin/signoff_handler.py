import json
import urllib.request
import urllib.error
import urllib.parse
import ssl
import splunk.rest as rest
import splunk.clilib.cli_common as cli


class SignoffHandler(rest.BaseRestHandler):

    def handle_POST(self):
        try:
            # 1. Parse record_id and required fields from browser request
            raw = self.request["payload"]
            payload = json.loads(raw)
            record_id = payload.get("record_id", "").strip()
            asset_id = payload.get("asset_id", "").strip()
            compliance_review_type = payload.get(
                "compliance_review_type", ""
            ).strip()
            device = payload.get("device", "").strip()
            department = payload.get("department", "")
            group = payload.get("group", "")
            date_of_job = payload.get("date_of_job", "").strip()

            if not record_id:
                self._send_error(400, "Missing record_id")
                return

            # 2. Get reviewer from Splunk session — never from browser
            reviewer = self._get_current_user()

            # 3. Read HEC config from app.conf — never exposed to browser
            hec_token, hec_url = self._get_hec_config()

            # 4. Build signoff event
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)

            # Base fields — always present
            event_body = {
                "event_type": "audit_signoff",
                "record_id": record_id,
                "asset_id": asset_id,
                "date_of_job": date_of_job,
                "compliance_review_type": compliance_review_type,
                "device": device,
                "department": department,
                "group": group,
                "reviewed_by": reviewer,
                "reviewed_at": now.isoformat(),
                "audit_year": str(now.year),
                "audit_source": "compliance_audit_app",
            }

            SERVER_ONLY = {
                "event_type",
                "reviewed_by",
                "reviewed_at",
                "audit_year",
                "audit_source",
                "reviewed_by_info",  # legacy aliases — never write these
                "review_date_info",
            }

            for key, value in payload.items():
                if key not in SERVER_ONLY and key not in event_body:
                    event_body[key] = value

            event = {
                "sourcetype": "user_audit_signoff",
                "index": "automation_local_user_group_audit",
                "event": event_body,
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
