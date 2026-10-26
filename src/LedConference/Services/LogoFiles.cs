namespace LedConference;

// The uploaded logo in data\ (logo.webp / .png / .jpg). Without one, the ward logo embedded in the exe is used.
public sealed class LogoFiles(Store store)
{
    static readonly string[] Names = ["logo.webp", "logo.png", "logo.jpg"];

    public string? Path() => Names.Select(n => System.IO.Path.Combine(store.Dir, n)).FirstOrDefault(File.Exists);

    // The file type from its first bytes, or null when it is not a WebP, PNG or JPG image.
    public static string? Kind(byte[] bytes) => bytes switch
    {
        [0x89, 0x50, 0x4E, 0x47, ..] => "png",
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [(byte)'R', (byte)'I', (byte)'F', (byte)'F', _, _, _, _, (byte)'W', (byte)'E', (byte)'B', (byte)'P', ..] => "webp",
        _ => null,
    };

    public void Replace(string kind, byte[] bytes)
    {
        Delete();
        File.WriteAllBytes(System.IO.Path.Combine(store.Dir, "logo." + kind), bytes);
    }

    public void Delete()
    {
        foreach (var name in Names) File.Delete(System.IO.Path.Combine(store.Dir, name));
    }
}
