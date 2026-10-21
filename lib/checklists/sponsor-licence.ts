/**
 * Sponsor licence (employer). Checked against GOV.UK on 19 Oct 2026: gov.uk/uk-visa-sponsorship-employers/apply-for-your-licence
 * and Appendix A (at least 4 supporting documents, sent within 5 working days of applying).
 */
export const sponsorLicence = {
  name: "Sponsor licence (employer)",
  extraFolders: ["06 Correspondence"],
  retiredKeys: ["Company-registration", "Accounts"],
  items: [
    { folder: "01 Company", groupLabel: "Company", title: "HMRC PAYE registration", typeKey: "PAYE", required: true,
      why: "An HMRC document showing the employer PAYE reference and Accounts Office reference. Counts toward the 4 documents the Home Office needs." },
    { folder: "01 Company", groupLabel: "Company", title: "Employer's liability insurance", typeKey: "Liability-insurance", required: true,
      why: "The current certificate: at least £5 million cover from an FCA-authorised insurer, naming the business." },
    { folder: "01 Company", groupLabel: "Company", title: "VAT registration", typeKey: "VAT", required: false,
      why: "The VAT certificate, if registered." },
    { folder: "02 Finances", groupLabel: "Finances", title: "Business bank statements", typeKey: "Business-bank-statement", required: true,
      why: "Recent statements or a bank letter. Required if trading for less than 18 months: from a UK bank regulated by the PRA and FCA." },
    { folder: "02 Finances", groupLabel: "Finances", title: "Accounts or financial reports", typeKey: "Company-accounts", required: false,
      why: "The latest annual accounts, if filed." },
    { folder: "03 Premises", groupLabel: "Premises", title: "Lease or ownership of premises", typeKey: "Premises", required: true,
      why: "The lease signed by all parties, or proof of ownership, for the trading address." },
    { folder: "04 People", groupLabel: "People", title: "Authorising Officer's passport", typeKey: "AO-passport", required: true,
      why: "Needed to complete the application: the photo page of the person who will be the Authorising Officer." },
    { folder: "04 People", groupLabel: "People", title: "Organisation chart", typeKey: "Organisation-chart", required: false,
      why: "A simple chart of staff and reporting lines. Helps the caseworker prepare the application." },
    { folder: "04 People", groupLabel: "People", title: "Regulator registration", typeKey: "Regulator", required: false,
      why: "Only if the business is regulated (for example CQC for care providers) or is a charity or franchise: this is then mandatory." },
    { folder: "05 Roles", groupLabel: "Roles", title: "Job descriptions", typeKey: "Job-description", required: true,
      why: "Job title, duties and salary for each role to be sponsored. Required for a Skilled Worker licence." },
  ],
};
