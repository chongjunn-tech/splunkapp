import json
import requests
import splunk.rest as rest
import splunk.clilib.cli_common as cli


class SignoffHandler(rest.BaseRestHandler):

    def handle_POST(self):
        import sys
        print("DEBUG sessionKey:", repr(getattr(self, 'sessionKey', 'NOT FOUND')), file=sys.stderr)
        print("DEBUG request keys:", list(self.request.keys()), file=sys.stderr)
        try:
            # ── 1. Parse request body from browser ──────────────────────────
            payload = json.loads(self.request["payload"])
            hostname = payload.get("hostname", "").strip()
            date_of_job = payload.get("date_of_job", "").strip()

            if not hostname or not date_of_job:
                self._send_error(400, "Missing hostname or date_of_job")
                return

            # ── 2. Get reviewer from Splunk session — not from the browser ──
            reviewer = self._get_current_user()

            # ── 3. Read HEC config from app.conf server-side ────────────────
            hec_token, hec_url = self._get_hec_config()

            # ── 4. Build and post the signoff event to HEC ──────────────────
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)

            event = {
                "sourcetype": "user_audit_signoff",
                "index": "automation_local_user_group_audit",
                "event": {
                    "event_type": "audit_signoff",
                    "hostname": hostname,
                    "date_of_job": date_of_job,
                    "reviewed_by": reviewer,
                    "reviewed_at": now.isoformat(),
                    "audit_year": str(now.year),
                    "remarks": "Reviewed via dashboard by " + reviewer,
                    "audit_source": "compliance_audit_app",
                },
            }

            response = requests.post(
                hec_url,
                headers={"Authorization": "Splunk " + hec_token},
                json=event,
                verify=False,  # internal loopback; swap for cert path in prod
                timeout=10,
            )

            if response.status_code != 200:
                self._send_error(502, "HEC returned: " + response.text)
                return

            self._send_json(200, {"status": "ok", "reviewer": reviewer})

        except Exception as e:
            self._send_error(500, str(e))

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _get_hec_config(self):
        cfg = cli.getConfStanza("app", "hec_config")
        return cfg["token"], cfg["url"]

    def _get_current_user(self):
        # sessionKey is injected by Splunk — never comes from the browser
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
