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
 * - Header with resource type, ID, and full URL
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Edit ${typeName} - ${idName}</title>
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
  <style>
    body { margin: 0; display: flex; flex-direction: column; height: 100vh; font-family: system-ui; }
    header { padding: 1rem; background: #1e1e1e; color: white; display: flex; justify-content: space-between; align-items: center; }
    header h1 { margin: 0; font-size: 1rem; }
    header .url { color: #888; font-family: monospace; }
    #editor { flex: 1; }
    button { background: #0078d4; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; transition: background 0.2s; min-width: 80px; }
    button:hover:not(:disabled) { background: #106ebe; }
    button:disabled { opacity: 0.8; cursor: wait; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${typeName} / ${idName}</h1>
      <span class="url">${resourceUrl}</span>
    </div>
    <button onclick="save()">Save</button>
  </header>
  <div id="editor"></div>
  <script>
    const data = ${json};
    let editor;

    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function() {
      editor = monaco.editor.create(document.getElementById('editor'), {
        value: JSON.stringify(data, null, 2),
        language: 'json',
        theme: 'vs-dark',
        automaticLayout: true
      });
    });

    function save() {
      const saveBtn = document.querySelector('button');
      const content = editor.getValue();

      // Validate JSON before save
      try {
        JSON.parse(content);
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      fetch('${resourceUrl}', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: content
      })
      .then(r => {
        if (r.ok) {
          saveBtn.textContent = 'Saved!';
          saveBtn.style.background = '#107c10';
          setTimeout(() => {
            saveBtn.textContent = 'Save';
            saveBtn.style.background = '';
            saveBtn.disabled = false;
          }, 2000);
        } else {
          throw new Error('HTTP ' + r.status);
        }
      })
      .catch(err => {
        saveBtn.textContent = 'Error!';
        saveBtn.style.background = '#d13438';
        setTimeout(() => {
          saveBtn.textContent = 'Save';
          saveBtn.style.background = '';
          saveBtn.disabled = false;
        }, 3000);
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
