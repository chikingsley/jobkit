export interface CandidateFact {
  claim: string;
  source: string;
}

export interface Candidate {
  channels: string[];
  email: string;
  facts: CandidateFact[];
  fullName: string;
  gender: "male" | "female";
  isLocalTo: string[];
  location: string;
  nativeEnglish: boolean;
  phone: string;
  shortName: string;
}

export const CANDIDATE: Candidate = {
  channels: ["Zoom", "WhatsApp"],
  email: "chibuzor.ejimofor@gmail.com",
  facts: [
    {
      claim: "240-hour TEFL certificate",
      source: "Global English, August 2019",
    },
    {
      claim: "bachelor's degree",
      source: "BS Chemical Engineering, West Virginia University, May 2018",
    },
    {
      claim: "two and a half years teaching English in Moscow",
      source: "Liden & Denz, September 2019 to April 2022",
    },
    {
      claim: "taught pre-intermediate through advanced adult classes",
      source: "Liden & Denz, September 2019 to April 2022",
    },
    {
      claim: "taught adult ESL in the United States",
      source: "Uceda School, Las Vegas, July 2022 to February 2023",
    },
    {
      claim: "ran classes online over Zoom through the pandemic",
      source: "Liden & Denz, remote delivery 2020 to 2022",
    },
    {
      claim: "Arizona adult education and substitute teaching certificates",
      source: "Arizona Department of Education, valid to 2033 and 2039",
    },
    {
      claim: "certified chemistry subject matter expert for grades 6 to 12",
      source: "Arizona Department of Education, valid to 2039",
    },
    {
      claim: "taught university biology review classes of 200 students",
      source: "West Virginia University, August 2014 to December 2016",
    },
    {
      claim: "coached children aged 7 to 10",
      source: "Mountaineer United Soccer, March 2014 to May 2015",
    },
  ],
  fullName: "Chibuzor (Chi) Ejimofor",
  gender: "male",
  isLocalTo: ["United States"],
  location: "Scottsdale, Arizona",
  nativeEnglish: true,
  phone: "+1 304 216 8700",
  shortName: "Chi",
};

export function disqualifying(
  restrictions: string[],
  country: string,
  candidate: Candidate = CANDIDATE
): string[] {
  return restrictions.filter((restriction) => {
    if (restriction === "female-only") {
      return candidate.gender !== "female";
    }
    if (restriction === "male-only") {
      return candidate.gender !== "male";
    }
    if (restriction === "native-speaker-only") {
      return !candidate.nativeEnglish;
    }
    if (restriction === "local-candidates-only") {
      return !candidate.isLocalTo.includes(country);
    }
    return restriction === "not-teaching";
  });
}
