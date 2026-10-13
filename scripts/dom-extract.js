/**
 * DOM Extraction Engine
 * Standards-aligned DOM extractor for Chrome CDP automation.
 *
 * Usage:
 *   cdp.mjs eval <target> "$(cat scripts/dom-extract.js)"
 *
 * Output:
 *   {
 *     elementTree: string,
 *     selectorMap: Record<number, ElementInfo>,
 *     pageInfo: {...},
 *     stats: {...}
 *   }
 */
(() => {
  const startTime = performance.now();
  const DEFAULT_CONFIG = {
    checkViewport: false,
    checkBlocked: true,
    maskSensitive: true,
    includeAttributes: [
      'id',
      'class',
      'name',
      'type',
      'placeholder',
      'title',
      'role',
      'aria-*',
      'data-*',
      'href',
      'src',
      'alt',
      'value',
    ],
    excludeAttributes: ['style'],
    maxTextLength: 100,
    maxElements: 500,
    includeHidden: false,
    includeNonInteractive: false,
    rootElement: document.body,
  };

  const externalConfig = window.__DOM_EXTRACT_CONFIG__ || {};
  const config = { ...DEFAULT_CONFIG, ...externalConfig };

  const stats = {
    totalNodes: 0,
    visibleNodes: 0,
    interactiveNodes: 0,
    filteredNodes: 0,
    extractionTime: 0,
  };

  const selectorMap = {};
  let currentIndex = 0;

  const clamp = (text, max = config.maxTextLength) => {
    if (text == null) return '';
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    return normalized.slice(0, max);
  };

  const round = (value) => Math.round(Number(value || 0) * 100) / 100;

  const getTagName = (node) =>
    node?.nodeType === Node.TEXT_NODE
      ? '#text'
      : (node?.tagName || '').toLowerCase();

  const getRect = (element) => {
    const rect = element.getBoundingClientRect();
    const x = round(rect.left);
    const y = round(rect.top);
    const width = round(rect.width);
    const height = round(rect.height);
    return {
      x,
      y,
      width,
      height,
      centerX: round(x + width / 2),
      centerY: round(y + height / 2),
    };
  };

  const isInViewport = (rect) =>
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;

  const checkVisibility = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') === 0) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    if (config.checkViewport && !isInViewport(rect)) return false;

    return true;
  };

  const getInputType = (element) =>
    (element.getAttribute('type') || element.type || '').toLowerCase();

  const getClassName = (element) => {
    const raw = element.className;
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw.baseVal === 'string') return raw.baseVal;
    return '';
  };

  const inferExplicitElementType = (element) => {
    const tagName = getTagName(element);
    const role = (element.getAttribute('role') || '').toLowerCase();
    const type = getInputType(element);

    if (tagName === 'button') return 'button';
    if (tagName === 'a' && element.getAttribute('href')) return 'link';
    if (tagName === 'textarea' || element.isContentEditable) return 'textarea';
    if (tagName === 'select') return 'select';
    if (tagName === 'label' || tagName === 'summary') return 'clickable';
    if (tagName === 'input') {
      if (type === 'hidden') return null;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'input';
    }
    if (role === 'button') return 'button';
    if (role === 'link') return 'link';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (['textbox', 'searchbox', 'spinbutton'].includes(role)) return 'input';
    if (role === 'option') return 'clickable';
    if (['tab', 'menuitem', 'slider'].includes(role)) return 'clickable';
    if (element.hasAttribute('onclick') || element.onclick !== null) return 'clickable';
    if (element.hasAttribute('onmousedown') || element.hasAttribute('onmouseup')) return 'clickable';
    if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') return 'clickable';
    return null;
  };

  const hasExplicitInteractiveAncestor = (element) => {
    let parent = element.parentElement;
    while (parent) {
      if (inferExplicitElementType(parent)) return true;
      parent = parent.parentElement;
    }
    return false;
  };

  const inferElementType = (element) => {
    const tagName = getTagName(element);
    const style = window.getComputedStyle(element);
    const explicitType = inferExplicitElementType(element);
    if (explicitType) return explicitType;

    if (['svg', 'path', 'use', 'circle'].includes(tagName)) return null;
    if (hasExplicitInteractiveAncestor(element)) return null;
    if (style.cursor === 'pointer') return 'clickable';
    return null;
  };

  const shouldSkipInput = (element) => {
    const type = getInputType(element);
    if (['hidden'].includes(type)) return true;
    if (element.classList.contains('el-select__input')) return true;
    if (element.classList.contains('el-cascader__search-input')) return true;
    return false;
  };

  const checkInteractivity = (element) => {
    if (element.nodeType !== Node.ELEMENT_NODE) return null;
    if (getTagName(element) === 'input' && shouldSkipInput(element)) return null;
    return inferElementType(element);
  };

  const checkBlocked = (element) => {
    if (!config.checkBlocked) return false;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (
      centerX < 0 ||
      centerY < 0 ||
      centerX > window.innerWidth ||
      centerY > window.innerHeight
    ) {
      return false;
    }

    const topElement = document.elementFromPoint(centerX, centerY);
    if (!topElement) return false;
    if (topElement === element) return false;
    if (element.contains(topElement)) return false;
    return true;
  };

  const findLabel = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

    const ariaLabel = clamp(element.getAttribute('aria-label'), 80);
    if (ariaLabel) return ariaLabel;

    if (element.labels && element.labels.length) {
      const labelText = clamp(
        Array.from(element.labels)
          .map((label) => label.innerText || label.textContent || '')
          .join(' '),
        80
      );
      if (labelText) return labelText;
    }

    const formItem = element.closest('.el-form-item, .ant-form-item');
    if (formItem) {
      const label = formItem.querySelector(
        '.el-form-item__label, .ant-form-item-label label'
      );
      if (label) return clamp(label.innerText || label.textContent, 80);
    }

    if (element.id) {
      const nativeLabel = document.querySelector(`label[for="${element.id}"]`);
      if (nativeLabel) return clamp(nativeLabel.innerText || nativeLabel.textContent, 80);
    }

    const parentLabel = element.closest('label');
    if (parentLabel) return clamp(parentLabel.innerText || parentLabel.textContent, 80);

    return '';
  };

  const getElementText = (element) => {
    const tagName = getTagName(element);
    const type = getInputType(element);

    if (tagName === 'input') {
      if (type === 'password') return element.value || '';
      if (['checkbox', 'radio'].includes(type)) return findLabel(element) || '';
      return element.value || element.getAttribute('placeholder') || findLabel(element) || '';
    }
    if (tagName === 'textarea') {
      return element.value || element.getAttribute('placeholder') || findLabel(element) || '';
    }
    if (tagName === 'select') {
      const selectedOption = element.options[element.selectedIndex];
      return selectedOption ? selectedOption.text : '';
    }

    const frameworkValue =
      element.querySelector?.('.el-select__selected-item, .el-select__placeholder, .ant-select-selection-item')?.innerText ||
      '';

    return frameworkValue || element.innerText || element.textContent || '';
  };

  const maskSensitiveData = (element, attrs, text) => {
    let isSensitive = false;
    const maskedAttrs = { ...attrs };
    let maskedText = text;
    const elementType = getInputType(element);

    const redact = () => {
      isSensitive = true;
      return '***';
    };

    if (elementType === 'password') {
      if (maskedAttrs.value) maskedAttrs.value = redact();
      maskedText = redact();
      return { attrs: maskedAttrs, text: maskedText, isSensitive };
    }

    const patterns = [
      /\b\d{15,19}\b/g,
      /\b\d{17}[\dXx]\b/g,
      /\b1[3-9]\d{9}\b/g,
      /\b[\w.-]+@[\w.-]+\.\w+\b/g,
    ];

    const applyPatterns = (value) => {
      let next = value;
      patterns.forEach((pattern) => {
        if (pattern.test(next)) {
          isSensitive = true;
          next = next.replace(pattern, '***');
        }
        pattern.lastIndex = 0;
      });
      return next;
    };

    Object.keys(maskedAttrs).forEach((key) => {
      if (['value', 'data-value'].includes(key)) {
        maskedAttrs[key] = applyPatterns(String(maskedAttrs[key]));
      } else {
        maskedAttrs[key] = applyPatterns(String(maskedAttrs[key]));
      }
    });
    maskedText = applyPatterns(String(maskedText || ''));

    return { attrs: maskedAttrs, text: maskedText, isSensitive };
  };

  const extractAttributes = (element) => {
    const attrs = {};
    const include = config.includeAttributes || [];
    const exclude = new Set(config.excludeAttributes || []);

    include.forEach((pattern) => {
      if (pattern === 'class') {
        const className = clamp(getClassName(element), 80);
        if (className && !exclude.has('class')) attrs.className = className;
        return;
      }

      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        Array.from(element.attributes || []).forEach((attribute) => {
          if (exclude.has(attribute.name)) return;
          if (attribute.name.startsWith('data-v-')) return;
          if (attribute.name.startsWith(prefix)) {
            attrs[attribute.name] = clamp(attribute.value, 120);
          }
        });
        return;
      }

      if (exclude.has(pattern)) return;
      const value = element.getAttribute(pattern);
      if (value !== null) {
        const key = pattern === 'role' ? 'ariaRole' : pattern;
        attrs[key] = clamp(value, 120);
      }
    });

    const label = findLabel(element);
    if (label) attrs.label = label;

    return attrs;
  };

  const serializeNodeAttributes = (attributes) => {
    const preferredKeys = [
      'id',
      'className',
      'name',
      'type',
      'placeholder',
      'title',
      'label',
      'aria-label',
      'ariaRole',
      'href',
    ];

    return preferredKeys
      .filter((key) => attributes[key])
      .map((key) => `${key}="${String(attributes[key]).replace(/"/g, "'")}"`)
      .join(' ');
  };

  const buildTree = (node, depth = 0, nearestParentIndex) => {
    stats.totalNodes += 1;

    if (node.nodeType === Node.TEXT_NODE) {
      return null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node;
    const visible = checkVisibility(element);
    if (visible) stats.visibleNodes += 1;
    if (!visible && !config.includeHidden) {
      stats.filteredNodes += 1;
      return null;
    }

    const elementType = checkInteractivity(element);
    const isInteractive = Boolean(elementType);
    if (isInteractive) stats.interactiveNodes += 1;

    const children = [];
    let nextParentIndex = nearestParentIndex;
    let index;
    let nodeAttributes = {};
    let nodeText = '';
    let elementState = null;

    if (isInteractive && currentIndex < config.maxElements) {
      index = currentIndex++;
      nextParentIndex = index;

      nodeAttributes = extractAttributes(element);
      nodeText = clamp(getElementText(element));

      if (config.maskSensitive) {
        const masked = maskSensitiveData(element, nodeAttributes, nodeText);
        nodeAttributes = masked.attrs;
        nodeText = clamp(masked.text);
        elementState = {
          isVisible: visible,
          isInteractive: true,
          isBlocked: checkBlocked(element),
          isSensitive: masked.isSensitive,
        };
      } else {
        elementState = {
          isVisible: visible,
          isInteractive: true,
          isBlocked: checkBlocked(element),
          isSensitive: false,
        };
      }

      selectorMap[index] = {
        index,
        tagName: getTagName(element),
        elementType,
        attributes: nodeAttributes,
        text: nodeText,
        rect: getRect(element),
        state: elementState,
        depth,
        ...(nearestParentIndex !== undefined ? { parentIndex: nearestParentIndex } : {}),
      };
    } else if (!isInteractive && !config.includeNonInteractive) {
      nodeAttributes = {};
      nodeText = '';
    } else {
      nodeAttributes = extractAttributes(element);
      nodeText = clamp(getElementText(element));
      if (config.maskSensitive) {
        const masked = maskSensitiveData(element, nodeAttributes, nodeText);
        nodeAttributes = masked.attrs;
        nodeText = clamp(masked.text);
      }
    }

    Array.from(element.childNodes).forEach((childNode) => {
      const childTree = buildTree(childNode, depth + 1, nextParentIndex);
      if (childTree) children.push(childTree);
    });

    const shouldKeep =
      index !== undefined ||
      children.length > 0 ||
      config.includeNonInteractive;

    if (!shouldKeep) {
      if (!isInteractive) stats.filteredNodes += 1;
      return null;
    }

    return {
      index,
      tagName: getTagName(element),
      attributes: nodeAttributes,
      text: nodeText,
      children,
      depth,
    };
  };

  const generateTreeText = (rootNode) => {
    const lines = [];

    const visit = (node) => {
      const indent = '  '.repeat(node.depth);
      const prefix =
        node.index !== undefined ? `[${node.index}]` : '[noindex]';
      const attrs = serializeNodeAttributes(node.attributes || {});
      const tagLine = attrs
        ? `${indent}${prefix} <${node.tagName} ${attrs}>`
        : `${indent}${prefix} <${node.tagName}>`;
      lines.push(tagLine);

      if (node.text) {
        lines.push(`${indent}+-- "${node.text.replace(/"/g, "'")}"`);
      }

      node.children.forEach(visit);
    };

    if (rootNode) visit(rootNode);
    return lines.join('\n');
  };

  const rootTree = buildTree(config.rootElement, 0, undefined);
  const result = {
    elementTree: generateTreeText(rootTree),
    selectorMap,
    pageInfo: {
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY,
      },
    },
    stats,
  };

  result.stats.extractionTime = round(performance.now() - startTime);

  return JSON.stringify(result, null, 2);
})()
