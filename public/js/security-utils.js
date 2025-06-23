/**
 * Security utilities for safe DOM manipulation
 */

/**
 * Safely escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Safely set text content without HTML interpretation
 * @param {HTMLElement} element - Element to set content for
 * @param {string} text - Text content to set
 */
function safeSetText(element, text) {
    element.textContent = text;
}

/**
 * Safely create HTML from template with escaped variables
 * @param {string} template - HTML template with {{variable}} placeholders
 * @param {Object} data - Data object with variables to substitute
 * @returns {string} - Safe HTML with escaped variables
 */
function safeTemplate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] ? escapeHtml(data[key]) : '';
    });
}

/**
 * Safely create table row with escaped data
 * @param {Array} columns - Array of column data
 * @returns {HTMLTableRowElement} - Safe table row element
 */
function createSafeTableRow(columns) {
    const row = document.createElement('tr');
    columns.forEach(columnData => {
        const cell = document.createElement('td');
        if (typeof columnData === 'string') {
            cell.textContent = columnData;
        } else if (columnData.html) {
            // Only allow specific safe HTML
            cell.innerHTML = columnData.html;
        } else {
            cell.textContent = columnData.text || '';
            if (columnData.className) {
                cell.className = columnData.className;
            }
        }
        row.appendChild(cell);
    });
    return row;
}

/**
 * Create safe button with click handler
 * @param {string} text - Button text
 * @param {Function} clickHandler - Click handler function
 * @param {string} className - CSS classes
 * @returns {HTMLButtonElement} - Safe button element
 */
function createSafeButton(text, clickHandler, className = '') {
    const button = document.createElement('button');
    button.textContent = text;
    button.className = className;
    button.onclick = clickHandler;
    return button;
}

// Export functions for use in other scripts
window.SecurityUtils = {
    escapeHtml,
    safeSetText,
    safeTemplate,
    createSafeTableRow,
    createSafeButton
};