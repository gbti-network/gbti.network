/**
 * Debug Module for Email Signature Generator
 * Provides debugging utilities that can be enabled/disabled via CONFIG
 */

const DEBUG = {
    /**
     * Initialize the debug module
     * @param {Object} config - The configuration object
     */
    init: function(config) {
        this.enabled = config && config.debug && config.debug.enabled;
        this.logLevel = (config && config.debug && config.debug.logLevel) || 'info';
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
            trace: 4
        };
        
        // Log initialization status
        this.info('Debug module initialized', { enabled: this.enabled, logLevel: this.logLevel });
    },
    
    /**
     * Get caller information (file and line number)
     * @returns {string} - Formatted caller information
     */
    _getCallerInfo: function() {
        try {
            // Create an Error to get the stack trace
            const err = new Error();
            
            // Parse the stack trace to extract file and line information
            const stackLines = err.stack.split('\n');
            
            // Skip the first few lines that reference this function and the calling log function
            // Usually need to skip 3 lines to get to the actual caller
            let callerLine = stackLines[3] || '';
            
            // Extract file path and line number using regex
            const fileMatch = callerLine.match(/at\s+(?:.*\s+\()?(?:.*\/)?([^\/]*):(\d+)(?::(\d+))?\)?$/);
            
            if (fileMatch) {
                const [, file, line] = fileMatch;
                return `[${file}:${line}]`;
            }
            
            return '';
        } catch (e) {
            // If anything goes wrong, return empty string
            return '';
        }
    },
    
    /**
     * Log an error message
     * @param {string} message - The message to log
     * @param {Object} data - Additional data to log
     */
    error: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.error) {
            const callerInfo = this._getCallerInfo();
            console.error(`%c[ERROR]${callerInfo} ${message}`, 'color: #ff0000; font-weight: bold;', data || '');
        }
    },
    
    /**
     * Log a warning message
     * @param {string} message - The message to log
     * @param {Object} data - Additional data to log
     */
    warn: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.warn) {
            const callerInfo = this._getCallerInfo();
            console.warn(`%c[WARN]${callerInfo} ${message}`, 'color: #ff9900; font-weight: bold;', data || '');
        }
    },
    
    /**
     * Log an info message
     * @param {string} message - The message to log
     * @param {Object} data - Additional data to log
     */
    info: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.info) {
            const callerInfo = this._getCallerInfo();
            console.info(`%c[INFO]${callerInfo} ${message}`, 'color: #0099ff; font-weight: bold;', data || '');
        }
    },
    
    /**
     * Log a debug message
     * @param {string} message - The message to log
     * @param {Object} data - Additional data to log
     */
    debug: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.debug(`%c[DEBUG]${callerInfo} ${message}`, 'color: #9900cc; font-weight: bold;', data || '');
        }
    },
    
    /**
     * Log a trace message with stack trace
     * @param {string} message - The message to log
     * @param {Object} data - Additional data to log
     */
    trace: function(message, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.trace) {
            const callerInfo = this._getCallerInfo();
            console.groupCollapsed(`%c[TRACE]${callerInfo} ${message}`, 'color: #999999; font-weight: bold;');
            console.trace(data || '');
            console.groupEnd();
        }
    },
    
    /**
     * Log a group of messages
     * @param {string} groupName - The name of the group
     * @param {Function} callback - The callback function to execute within the group
     */
    group: function(groupName, callback) {
        if (this.enabled) {
            const callerInfo = this._getCallerInfo();
            console.groupCollapsed(`%c[GROUP]${callerInfo} ${groupName}`, 'color: #00cc99; font-weight: bold;');
            callback();
            console.groupEnd();
        }
    },
    
    /**
     * Log the value of a variable
     * @param {string} name - The name of the variable
     * @param {*} value - The value of the variable
     */
    variable: function(name, value) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.info(`%c[VAR]${callerInfo} ${name}:`, 'color: #cc6600; font-weight: bold;', value);
        }
    },
    
    /**
     * Log the timing of a function
     * @param {string} name - The name of the function
     * @param {Function} fn - The function to time
     * @returns {*} - The result of the function
     */
    time: function(name, fn) {
        if (!this.enabled) {
            return fn();
        }
        
        const callerInfo = this._getCallerInfo();
        console.time(`[TIME]${callerInfo} ${name}`);
        const result = fn();
        console.timeEnd(`[TIME]${callerInfo} ${name}`);
        return result;
    },
    
    /**
     * Log a color-related message with color preview
     * @param {string} message - The message to log
     * @param {string} color - The color to preview
     * @param {Object} data - Additional data to log
     */
    color: function(message, color, data) {
        if (this.enabled && this.logLevels[this.logLevel] >= this.logLevels.debug) {
            const callerInfo = this._getCallerInfo();
            console.info(
                `%c[COLOR]${callerInfo} ${message}`, 
                `color: ${color}; font-weight: bold;`,
                `%c■■■■■■■■■■`, 
                `background-color: ${color}; color: transparent;`,
                data || ''
            );
        }
    },
    
    /**
     * Toggle debug mode to visualize clickable areas
     * Press Ctrl+Shift+D to toggle
     */
    initDebugModeToggle: function() {
        document.addEventListener('keydown', function(event) {
            // Check if Ctrl+Shift+D was pressed
            if (event.ctrlKey && event.shiftKey && event.key === 'D') {
                document.body.classList.toggle('debug-mode');
                DEBUG.info('Debug mode toggled:', document.body.classList.contains('debug-mode'));
            }
        });
    }
};

// Initialize debug mode toggle
DEBUG.initDebugModeToggle();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DEBUG;
}