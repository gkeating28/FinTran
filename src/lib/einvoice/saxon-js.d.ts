declare module "saxon-js" {
  const SaxonJS: {
    transform(options: {
      stylesheetFileName?: string;
      stylesheetInternal?: unknown;
      sourceText: string;
      destination: "serialized";
    }): { principalResult?: string };
  };
  export default SaxonJS;
}
