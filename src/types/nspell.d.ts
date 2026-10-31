declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
  }

  export default function nspell(aff: string | Uint8Array, dic: string | Uint8Array): NSpell;
}
