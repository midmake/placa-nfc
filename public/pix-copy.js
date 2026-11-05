// Shared by the administrative NFC link and the public Pix clipboard button.
async function copyPixField(field, feedback, successText) {
  clearTimeout(feedback.copyTimer);
  feedback.textContent = "";
  delete feedback.dataset.copied;
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    field.focus();
    field.select();
    feedback.textContent = "Selecione Copiar no menu do seu dispositivo.";
    return;
  }
  feedback.textContent = successText;
  feedback.dataset.copied = "true";
  feedback.copyTimer = setTimeout(() => {
    feedback.textContent = "";
    delete feedback.dataset.copied;
  }, 2400);
}

const publicPixCopy = document.querySelector("#copy[data-copied-text]");
if (publicPixCopy) publicPixCopy.onclick = () => copyPixField(
  document.querySelector("#value"),
  document.querySelector("#feedback"),
  publicPixCopy.dataset.copiedText,
);
