export type CodeName = {
  code: string;
  name: string;
};

export function countryChoices(countries: CodeName[]) {
  return [...countries].sort((left, right) => {
    if (left.code === "IE") return -1;
    if (right.code === "IE") return 1;
    return left.name.localeCompare(right.name);
  });
}
