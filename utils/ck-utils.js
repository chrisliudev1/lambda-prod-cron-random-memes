let CKUtils = {
    dataInit: function(obj, key, defaultValue) {
        let keys = key.split('.');

        let currentValue = obj;
        for (let i = 0, j = keys.length; i < j; i++) {
            currentValue = _dataInit(currentValue, keys[i], defaultValue);
            if (currentValue === null || currentValue === defaultValue) {
                if (typeof defaultValue !== 'undefined') return defaultValue;
                return null;
            }
        }

        return currentValue;

        function _dataInit(obj, key, defaultValue) {
            if (typeof obj === 'undefined' || typeof obj[key] === 'undefined') {
                if (typeof defaultValue !== 'undefined') return defaultValue;
                return null;
            }
            return obj[key];
        }
    },

    slug: function(str) {
        const sanitized = str.replace(/[^0-9a-z\/]+/gi, '-');
        return encodeURIComponent(sanitized);
    },

    empty: function(str) {
        if (str == null) return true;
        if (Array.isArray(str) && str.length == 0) return true;
        if (typeof str == 'string' && str.trim().length == 0) return true;
        return false;
    },

    asyncForEach: async function(array, callback) {
        for (let i = 0, j = array.length; i < j; i++) {
            await callback(array[i], i, array);
        }
    },

    dump: function(data) {
        console.log(JSON.stringify(data, null, 2));
    },

    dd: function(...args) {
        console.log(args);
        process.exit();
    },

    isLambda: function() {
        return !!(process.env.LAMBDA_TASK_ROOT || false);
    }
};

module.exports = {
    CKUtils: CKUtils
};
