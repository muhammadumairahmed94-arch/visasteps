/**
 * British citizenship by naturalisation (form AN). Checked against GOV.UK on 19 Oct 2026:
 * gov.uk/apply-citizenship-indefinite-leave-to-remain and "Form AN: guidance".
 */
export const citizenship = {
  name: "British citizenship",
  extraFolders: ["06 Translations", "07 Correspondence"],
  retiredKeys: ["Address", "Police-certificate"],
  items: [
    { folder: "01 Identity", groupLabel: "Identity", title: "Passport", typeKey: "Passport", required: true,
      why: "A clear photo of the personal details page." },
    { folder: "01 Identity", groupLabel: "Identity", title: "Passports for the qualifying period", typeKey: "Previous-passports", required: true,
      why: "Every passport held in the last 5 years (3 years if married to a British citizen), including expired ones." },
    { folder: "01 Identity", groupLabel: "Identity", title: "ILR or settled status evidence", typeKey: "ILR", required: true,
      why: "The residence permit (even if expired) or eVisa share code. ILR must usually be held for 12 months, unless married to a British citizen." },
    { folder: "02 Knowledge and English", groupLabel: "Knowledge and English", title: "Life in the UK test pass", typeKey: "Life-in-UK", required: true,
      why: "The test reference number, or the pass letter if passed before 1 October 2019." },
    { folder: "02 Knowledge and English", groupLabel: "Knowledge and English", title: "English language evidence", typeKey: "English", required: true,
      why: "Level B1 or higher: the SELT reference number, a UK degree, or an Ecctis statement for a degree taught in English." },
    { folder: "03 Residence", groupLabel: "Residence", title: "Absences from the UK", typeKey: "Absences", required: true,
      why: "Every trip outside the UK in the qualifying period, with dates. Usually no more than 450 days in 5 years and 90 days in the last 12 months." },
    { folder: "04 Referees and character", groupLabel: "Referees and character", title: "Referee details", typeKey: "Referees", required: true,
      why: "Two people who have known the applicant for 3 years and are not related. One a professional; the other a British passport holder who is a professional or over 25." },
    { folder: "04 Referees and character", groupLabel: "Referees and character", title: "Tax and driving records", typeKey: "Tax-driving", required: false,
      why: "Self Assessment statement of account if paying tax outside PAYE; DVLA record if the licence has endorsements." },
    { folder: "05 Marriage", groupLabel: "Marriage", title: "Marriage certificate", typeKey: "Marriage-certificate", required: false,
      why: "Only if applying as the spouse or civil partner of a British citizen." },
    { folder: "05 Marriage", groupLabel: "Marriage", title: "Spouse's British passport", typeKey: "Spouse-passport", required: false,
      why: "Only if applying as a spouse: the partner's British passport, or naturalisation or registration certificate." },
  ],
};
