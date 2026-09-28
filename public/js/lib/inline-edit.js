// Inline text edit (DOM, imports nothing). Swaps el's content for an <input>; Enter or blur
// commits, Esc cancels. el.dataset.editing is set while editing so re-renders can skip el.
// onCommit(trimmedValue) runs only when the value changed; el is back to plain `value` text
// by then, so the caller re-renders it with whatever it saved.
export const inlineEdit = (el, { value = '', maxLength, placeholder = '', onCommit }) => {
  if (el.dataset.editing) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = value;
  input.placeholder = placeholder;
  if (maxLength) input.maxLength = maxLength;
  const edit = { done: false };
  // Enter/Esc then the blur caused by removing the input would finish twice: guard.
  const finish = (commit, refocus) => {
    if (edit.done) return;
    edit.done = true;
    const next = input.value.trim();
    delete el.dataset.editing;
    el.textContent = value;
    if (refocus) el.focus();
    if (commit && next !== value.trim()) onCommit(next);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      // Korean IME: the Enter that confirms a composed syllable is not a commit.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); e.stopPropagation();
      finish(true, true);
      return;
    }
    // stopPropagation: main.js closes the panel on a document-level Escape.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
  });
  input.addEventListener('blur', () => finish(true, false));
  el.dataset.editing = '1';
  el.replaceChildren(input);
  input.focus();
  input.select();
};
