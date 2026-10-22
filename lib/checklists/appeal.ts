/**
 * Refused visa: administrative review or appeal. Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/ask-for-a-visa-administrative-review/if-youre-outside-the-uk (28 days), gov.uk/immigration-asylum-tribunal.
 */
export const appeal = {
  name: "Refused visa appeal",
  extraFolders: ["05 Correspondence"],
  retiredKeys: [] as string[],
  items: [
    { folder: "01 Refusal", groupLabel: "Refusal", title: "Refusal letter", typeKey: "Refusal-letter", required: true,
      why: "The full decision letter, all pages. It shows whether a review or appeal is possible. Upload it straight away — the deadline is usually 28 days from the date of the letter.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "01 Refusal", groupLabel: "Refusal", title: "Application that was refused", typeKey: "Original-application", required: true,
      why: "A copy of the application form you submitted, including the GWF reference number.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "02 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the page with your photo and personal details.",
      howToGet: "Open your passport to the photo page. Take a photo in good light so all the text is easy to read. You can also scan it.",
      exampleImage: null, dateWindow: null },
    { folder: "03 Evidence", groupLabel: "Evidence", title: "Documents sent with the application", typeKey: "Original-evidence", required: false,
      why: "Everything you submitted with the refused application. You can upload several files at once.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "03 Evidence", groupLabel: "Evidence", title: "New evidence", typeKey: "New-evidence", required: false,
      why: "Anything that answers the reasons for refusal. Your caseworker will advise what can be used.",
      howToGet: null, exampleImage: null, dateWindow: null },
    { folder: "04 Immigration history", groupLabel: "Immigration history", title: "Previous visas and refusals", typeKey: "Previous-visas", required: false,
      why: "Earlier visas or refusal letters from any country.",
      howToGet: null, exampleImage: null, dateWindow: null },
  ],
};
