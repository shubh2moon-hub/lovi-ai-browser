/**
 * DOM Distiller module inspired by Agent-E's DOM helper & accessibility tree indexing
 * Extracts visible, interactive elements from the web page and labels them with data-lovi-id attributes
 * for target-specific clicking, typing, and form auto-filling.
 */

const DOM_DISTILL_SCRIPT = `
(function distillDOM() {
    try {
        const interactiveSelectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [tabindex]:not([tabindex="-1"])';
        const elements = Array.from(document.querySelectorAll(interactiveSelectors));

        let index = 0;
        const distilledElements = [];

        elements.forEach((el) => {
            // Check visibility
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';

            if (!isVisible) return;

            // Assign indexed attribute for exact selector targeting
            const idStr = String(index);
            el.setAttribute('data-lovi-id', idStr);

            const tagName = el.tagName.toLowerCase();
            const type = el.getAttribute('type') || '';
            const name = el.getAttribute('name') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const value = el.value || '';
            const href = el.getAttribute('href') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const textContent = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);

            distilledElements.push({
                loviId: idStr,
                tag: tagName,
                type,
                name,
                placeholder,
                value: type === 'password' ? '***' : value.slice(0, 40),
                href: href ? (href.startsWith('http') ? href : new URL(href, window.location.href).href) : '',
                ariaLabel,
                text: textContent
            });

            index++;
        });

        // Format clean indexed text summary for LLM context (Agent-E style element index)
        const elementSummary = distilledElements.map(item => {
            let desc = \`[id=\${item.loviId}] <\${item.tag}\`;
            if (item.type) desc += \` type="\${item.type}"\`;
            if (item.name) desc += \` name="\${item.name}"\`;
            if (item.placeholder) desc += \` placeholder="\${item.placeholder}"\`;
            if (item.ariaLabel) desc += \` aria-label="\${item.ariaLabel}"\`;
            desc += \`>\`;
            if (item.text) desc += \` "\${item.text}"\`;
            if (item.href) desc += \` (\${item.href})\`;
            return desc;
        }).slice(0, 50).join('\\n');

        return {
            url: window.location.href,
            title: document.title,
            elementCount: distilledElements.length,
            elements: distilledElements,
            summary: elementSummary || 'No interactive elements found.'
        };
    } catch (err) {
        return {
            url: window.location.href,
            title: document.title,
            elementCount: 0,
            elements: [],
            summary: 'Failed to distill DOM: ' + err.message
        };
    }
})()
`;

const CLICK_ELEMENT_SCRIPT = (id) => `
(function clickElement() {
    const el = document.querySelector('[data-lovi-id="${id}"]');
    if (!el) return { success: false, error: 'Element [data-lovi-id="${id}"] not found.' };
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.click();
    return { success: true, tag: el.tagName, text: (el.innerText || el.value || '').trim() };
})()
`;

const TYPE_ELEMENT_SCRIPT = (id, text) => `
(function typeElement() {
    const el = document.querySelector('[data-lovi-id="${id}"]');
    if (!el) return { success: false, error: 'Element [data-lovi-id="${id}"] not found.' };
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, tag: el.tagName, newValue: el.value };
})()
`;

module.exports = {
    DOM_DISTILL_SCRIPT,
    CLICK_ELEMENT_SCRIPT,
    TYPE_ELEMENT_SCRIPT
};
