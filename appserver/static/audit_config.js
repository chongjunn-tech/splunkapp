define([], function () {

    return {
        indexes: {
            auditIndex: "automation_local_user_group_audit"
        },

        sourcetypes: {
            auditLogs:      "custom:automation_local_user_group_audit:logs",
            assetLogs:      "custom:automation_local_user_group_audit:asset_logs",
            assetGroupLogs: "custom:automation_local_user_group_audit:asset_group_logs",
            accountLogs:    "custom:automation_local_user_group_audit:account_logs",
            signoff:        "user_audit_signoff"
        },

        ui: {
            refreshDelay: 2000,
            pageSize: 10,
            hostnameWidth: 120
        }
    };

});