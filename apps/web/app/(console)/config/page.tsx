import { redirect } from 'next/navigation';

/** /config has no content of its own - departments is where setup starts. */
export default function ConfigIndex() {
  redirect('/config/departments');
}
