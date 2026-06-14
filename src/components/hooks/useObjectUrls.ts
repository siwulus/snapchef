import { useEffect, useRef, useState } from "react";

export interface SelectedPhoto {
  file: File;
  url: string;
}

// Manages a list of selected files and their object-URL previews, revoking URLs correctly so
// previews never leak and a still-displayed preview is never revoked: `removeAt` revokes only the
// removed URL, and the remaining URLs are revoked once — on unmount. A ref keeps the unmount
// cleanup pointed at the latest list without re-running (and revoking live previews) on every change.
export const useObjectUrls = () => {
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const photosRef = useRef<SelectedPhoto[]>(photos);

  // Keep the ref pointed at the latest list (updated after render, never during it) so the
  // unmount-only cleanup below revokes exactly the URLs that are still live.
  useEffect(() => {
    photosRef.current = photos;
  });

  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => {
        URL.revokeObjectURL(photo.url);
      });
    },
    [],
  );

  // The file input replaces the selection wholesale, so revoke the previous URLs before minting new.
  const replace = (files: File[]) => {
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.url);
    });
    setPhotos(files.map((file) => ({ file, url: URL.createObjectURL(file) })));
  };

  const removeAt = (index: number) => {
    URL.revokeObjectURL(photos[index].url);
    setPhotos((current) => current.filter((_, i) => i !== index));
  };

  const clear = () => {
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.url);
    });
    setPhotos([]);
  };

  return { photos, replace, removeAt, clear };
};
