import { PDFBool, PDFDict, PDFName, PDFDropdown, PDFOptionList, PDFTextField } from "@cantoo/pdf-lib";
import { loadPdf, savePdf } from "@/pdf/docUtils";
import { embedStandardFont } from "@/pdf/fonts";

const ACRO_FORM = PDFName.of("AcroForm");
const NEED_APPEARANCES = PDFName.of("NeedAppearances");
/** Annotation flags: a widget with either one is not shown by viewers. */
const HIDDEN = 1 << 1;
const NO_VIEW = 1 << 5;

/**
 * Burn the form into the pages: every field keeps its current look (values included) as plain
 * page content and stops being editable. Fields without an appearance get one (Helvetica), and
 * so do text and choice fields of forms that ask viewers to rebuild appearances
 * (/NeedAppearances), since the ones in the file may be stale. Hidden widgets are dropped
 * instead of being painted. A document without a form comes back re-saved, otherwise unchanged.
 */
export async function flattenForm(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  // getForm() would create an empty AcroForm in a document that has none.
  const acro = doc.context.lookup(doc.catalog.get(ACRO_FORM));
  if (!(acro instanceof PDFDict)) return savePdf(doc);

  const form = doc.getForm();
  const fields = form.getFields();
  if (fields.length > 0) {
    const rebuild = doc.context.lookup(acro.get(NEED_APPEARANCES)) === PDFBool.True;

    // A widget the viewer would not show must not show up after flattening either.
    for (const field of fields) {
      const widgets = field.acroField.getWidgets();
      for (let i = widgets.length - 1; i >= 0; i--) {
        if (!widgets[i].hasFlag(HIDDEN) && !widgets[i].hasFlag(NO_VIEW)) continue;
        const ref = doc.context.getObjectRef(widgets[i].dict);
        if (ref) doc.findPageForAnnotationRef(ref)?.node.removeAnnot(ref);
        field.acroField.removeWidget(i);
      }
    }

    // Field by field so one value Helvetica cannot encode does not abort the whole document;
    // that field keeps whatever appearance it already has.
    const font = await embedStandardFont(doc, "helvetica");
    for (const field of fields) {
      try {
        const textual = field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList;
        if (rebuild && textual) form.markFieldAsDirty(field.ref);
        if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font);
      } catch {
        // keep the existing appearance
      }
    }
    form.flatten({ updateFieldAppearances: false });
  }
  // An AcroForm without fields is dead weight (and makes some viewers show a "form" bar).
  if (form.getFields().length === 0) doc.catalog.delete(ACRO_FORM);
  return savePdf(doc);
}
