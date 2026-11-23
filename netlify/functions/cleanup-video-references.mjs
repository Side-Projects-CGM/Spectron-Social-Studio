import uploads from '../lib/video-reference-uploads.cjs';
// Netlify invokes this on its production schedule, not on public HTTP requests.
export default async function cleanup(){
  const service=uploads.createReferenceUploads({store:uploads.openUploadStore()});
  await service.sweep();
  return new Response(null,{status:204});
}
export const config={schedule:'@hourly'};
