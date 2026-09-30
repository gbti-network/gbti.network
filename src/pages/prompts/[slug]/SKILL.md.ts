// sow-109: a public skill's own file at /prompts/<slug>/SKILL.md, so the page's Download link and the extension's
// reader fetch exactly the bytes the author committed. Only a published, public skill that has the file: a
// members-only skill's file is never served as plain text.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { isPublic } from '../../../lib/content';
import { skillFileOf } from '../../../lib/skill-install';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const skills = (await getCollection('prompt')).filter((p) => p.data.kind === 'skill' && isPublic(p));
  return skills.flatMap((p) => {
    const file = skillFileOf(p);
    return file ? [{ params: { slug: p.data.slug }, props: { text: file.text } }] : [];
  });
};

export const GET: APIRoute = ({ props }) =>
  new Response(props.text as string, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
