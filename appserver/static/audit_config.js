define([], function () {

    return {
        splunk: {
            hecUrl: "http://localhost:8088/services/collector/event",
            hecToken: "94567e0d-0e2d-491f-ae98-95ce35320d86"
        },

        indexes: {
            auditIndex: "automation_local_user_group_audit"
        },

        sourcetypes: {
            auditLogs: "custom:automation_local_user_group_audit:logs",
            signoff: "user_audit_signoff"
        },

        ui: {
            refreshDelay: 2000,
            pageSize: 10,
        }
    };

});