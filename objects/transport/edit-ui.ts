/**
 * Edit UI Endpoint
 *
 * Generates an HTML page with Monaco editor for inline resource editing.
 * Accessible at /:type/:id/edit routes.
 *
 * Features:
 * - Monaco editor with JSON language support
 * - Dark theme
 * - Save button that PUTs changes to the resource URL
 * - Cancel button to return to item view
 * - Header with resource type, ID, and full URL
 * - Keyboard shortcuts (Ctrl+S / Cmd+S to save)
 * - Error message display
 * - Loading state during save
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Data structure for edit UI generation
 */
export interface EditUIData {
  $context: string
  $type: string
  $id: string
  [key: string]: unknown
}

// ============================================================================
// HTML GENERATION
// ============================================================================

/**
 * Generate an HTML page with Monaco editor for editing a resource.
 *
 * @param data - The resource data including $context, $type, $id
 * @returns HTML string for the edit page
 */
export function generateEditUI(data: EditUIData): string {
  const resourceUrl = data.$id
  const json = JSON.stringify(data, null, 2)

  // Extract type name (last part of $type URL)
  const typeName = data.$type.includes('/')
    ? data.$type.split('/').pop()!
    : data.$type

  // Extract ID (last part of $id URL)
  const idName = data.$id.includes('/')
    ? data.$id.split('/').pop()!
    : data.$id

  // Extract the view URL path (without /edit) for cancel/navigation
  // resourceUrl could be a full URL (http://localhost:3000/customers/alice) or path (/customers/alice)
  // We need the path portion for the link href
  let viewUrlPath: string
  try {
    const urlObj = new URL(resourceUrl)
    viewUrlPath = urlObj.pathname
  } catch {
    // Already a path, not a full URL
    viewUrlPath = resourceUrl
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Edit ${typeName} - ${idName}</title>
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
  <style>
    body { margin: 0; display: flex; flex-direction: column; height: 100vh; font-family: system-ui; background: #1e1e1e; }
    header { padding: 1rem; background: #252526; color: white; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #3c3c3c; }
    header h1 { margin: 0; font-size: 1rem; }
    header .url { color: #888; font-family: monospace; font-size: 0.875rem; }
    .header-left { display: flex; flex-direction: column; gap: 0.25rem; }
    .header-right { display: flex; gap: 0.5rem; align-items: center; }
    #editor { flex: 1; }
    .links { padding: 0.5rem 1rem; background: #252526; border-top: 1px solid #3c3c3c; }
    .links a { color: #3794ff; text-decoration: none; font-size: 0.875rem; }
    .links a:hover { text-decoration: underline; }
    button { color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; transition: background 0.2s; min-width: 80px; font-size: 0.875rem; }
    button:hover:not(:disabled) { opacity: 0.9; }
    button:disabled { opacity: 0.7; cursor: wait; }
    .save-btn { background: #0078d4; }
    .cancel-btn { background: #3c3c3c; }
    .cancel-btn:hover { background: #4c4c4c; }
    .error-message { display: none; background: #5a1d1d; color: #f48771; padding: 0.75rem 1rem; font-size: 0.875rem; border-bottom: 1px solid #be1100; }
    .error-message.visible { display: block; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>${typeName} / ${idName}</h1>
      <span class="url">${resourceUrl}</span>
    </div>
    <div class="header-right">
      <button class="cancel-btn" data-testid="cancel-button" onclick="cancel()">Cancel</button>
      <button class="save-btn" data-testid="save-button" onclick="save()">Save</button>
    </div>
  </header>
  <div class="error-message" data-testid="error-message"></div>
  <div id="editor"></div>
  <div class="links">
    <a href="${viewUrlPath}">Back to ${typeName}</a>
  </div>
  <script>
    const data = ${json};
    const resourceUrl = '${viewUrlPath}';
    const viewUrl = '${viewUrlPath}';
    let editor;

    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function() {
      editor = monaco.editor.create(document.getElementById('editor'), {
        value: JSON.stringify(data, null, 2),
        language: 'json',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on'
      });
    });

    function showError(message) {
      const errorEl = document.querySelector('[data-testid="error-message"]');
      errorEl.textContent = message;
      errorEl.classList.add('visible');
    }

    function hideError() {
      const errorEl = document.querySelector('[data-testid="error-message"]');
      errorEl.classList.remove('visible');
    }

    function cancel() {
      window.location.href = viewUrl;
    }

    function save() {
      const saveBtn = document.querySelector('[data-testid="save-button"]');
      const content = editor.getValue();

      hideError();

      // Validate JSON before save
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        showError('Invalid JSON: ' + e.message);
        return;
      }

      // Set loading state
      saveBtn.disabled = true;
      saveBtn.setAttribute('data-loading', 'true');
      saveBtn.textContent = 'Saving...';

      fetch(resourceUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: content
      })
      .then(async r => {
        if (r.ok) {
          // Navigate to item view on success
          window.location.href = viewUrl;
        } else {
          const errorData = await r.json().catch(() => ({ error: 'Save failed' }));
          throw new Error(errorData.error || 'HTTP ' + r.status);
        }
      })
      .catch(err => {
        showError(err.message || 'Save failed');
        saveBtn.disabled = false;
        saveBtn.removeAttribute('data-loading');
        saveBtn.textContent = 'Save';
      });
    }

    // Keyboard shortcut: Ctrl+S / Cmd+S to save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
  </script>
</body>
</html>`
}

// ============================================================================
// REQUEST HANDLER
// ============================================================================

/**
 * Handle an edit UI request.
 *
 * @param request - The incoming request
 * @param getData - Function to retrieve the resource data
 * @returns HTML response with Monaco editor
 */
export async function handleEditRequest(
  request: Request,
  getData: () => Promise<EditUIData | null>
): Promise<Response> {
  const data = await getData()
  if (!data) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/html' } })
  }

  const html = generateEditUI(data)
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Generate edit UI data for a resource that may not exist yet.
 * Creates a minimal data structure for new resources.
 *
 * @param ns - The namespace URL
 * @param type - The resource type (e.g., 'Customer')
 * @param id - The resource ID
 * @param existingData - Existing resource data if available
 * @returns EditUIData structure
 */
export function createEditUIData(
  ns: string,
  type: string,
  id: string,
  existingData?: Record<string, unknown> | null
): EditUIData {
  const $id = `${ns}/${type.toLowerCase()}s/${id}`
  const $type = `${ns}/${type}`
  const $context = ns

  if (existingData) {
    return {
      $context,
      $type,
      $id,
      ...existingData,
    }
  }

  // Return minimal data for new/non-existent resources
  return {
    $context,
    $type,
    $id,
  }
}
