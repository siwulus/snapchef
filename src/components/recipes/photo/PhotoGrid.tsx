import type { RecipeGalleryPhoto } from "@/lib/core/boundry/recipe";

interface PhotoGridProps {
  photos: RecipeGalleryPhoto[];
}

export const PhotoGrid = ({ photos }: PhotoGridProps) => {
  return (
    <>
      {photos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-lg font-semibold">Zdjęcia</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <img
                key={photo.id}
                src={photo.photoUrl}
                alt="Zdjęcie produktów"
                loading="lazy"
                className="ring-foreground/10 aspect-square w-full rounded-none object-cover ring-1"
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
};
