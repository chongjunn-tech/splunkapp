define([], function () {

    return {
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