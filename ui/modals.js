export function createModalApi() {
  const modal = document.querySelector("#modal");
  const form = document.querySelector("#modalForm");
  const title = document.querySelector("#modalTitle");
  const eyebrow = document.querySelector("#modalEyebrow");
  const body = document.querySelector("#modalBody");
  const actions = document.querySelector("#modalActions");

  function close() {
    if (modal.open) modal.close();
  }

  function open({ modalTitle, modalEyebrow = "Acción", html = "", confirmText = "Guardar", cancelText = "Cancelar", danger = false, onSubmit }) {
    title.textContent = modalTitle;
    eyebrow.textContent = modalEyebrow;
    body.innerHTML = html;
    actions.innerHTML = `
      <button class="btn" type="submit" value="cancel">${cancelText}</button>
      <button class="btn ${danger ? "danger" : "primary"}" type="submit" value="confirm">${confirmText}</button>
    `;

    form.onsubmit = async (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      if (submitter?.value !== "confirm") {
        close();
        return;
      }
      try {
        submitter.disabled = true;
        const formData = new FormData(form);
        await onSubmit?.(Object.fromEntries(formData.entries()), form);
        close();
      } finally {
        submitter.disabled = false;
      }
    };

    modal.showModal();
  }

  function confirm({ modalTitle, message, confirmText = "Confirmar", danger = false, onConfirm }) {
    return open({
      modalTitle,
      modalEyebrow: danger ? "Cuidado" : "Confirmación",
      html: `<p class="muted" style="line-height:1.5;margin:0">${message}</p>`,
      confirmText,
      danger,
      onSubmit: onConfirm
    });
  }

  return { open, confirm, close };
}
