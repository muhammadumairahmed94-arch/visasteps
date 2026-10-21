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
      why: "The full decision, all pages. It says whether review or appeal is possible. Upload it straight away: deadlines are usually 28 days." },
    { folder: "01 Refusal", groupLabel: "Refusal", title: "Application that was refused", typeKey: "Original-application", required: true,
      why: "A copy of the submitted application form, including the GWF reference number." },
    { folder: "02 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page." },
    { folder: "03 Evidence", groupLabel: "Evidence", title: "Documents sent with the application", typeKey: "Original-evidence", required: false,
      why: "Everything submitted with the refused application. Several files can be uploaded at once." },
    { folder: "03 Evidence", groupLabel: "Evidence", title: "New evidence", typeKey: "New-evidence", required: false,
      why: "Anything that answers the reasons for refusal. The caseworker will advise what can be used." },
    { folder: "04 Immigration history", groupLabel: "Immigration history", title: "Previous visas and refusals", typeKey: "Previous-visas", required: false,
      why: "Earlier visas or refusal letters from any country." },
  ],
};
