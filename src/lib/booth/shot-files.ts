/**
 * Puts the captured frames on the form's file input.
 *
 * A server action keeps the files that belong to `<input type="file">`.
 * Appending a `File` built from a canvas blob after the form is built does
 * not arrive, and the save then says the strip is missing photos.
 */
export function assignShotFiles(
  input: HTMLInputElement,
  shots: readonly Blob[],
): void {
  const transfer = new DataTransfer();
  shots.forEach((blob, index) => {
    transfer.items.add(
      new File([blob], `shot-${index}.jpg`, { type: "image/jpeg" }),
    );
  });
  input.files = transfer.files;
}
