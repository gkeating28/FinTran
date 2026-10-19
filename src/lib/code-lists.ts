export type CodeName = {
  code: string;
  name: string;
};

export type UnitChoice = {
  code: string;
  name: string;
  common: boolean;
};

export function countryChoices(countries: CodeName[]) {
  return [...countries].sort((left, right) => {
    if (left.code === "IE") return -1;
    if (right.code === "IE") return 1;
    return left.name.localeCompare(right.name);
  });
}
