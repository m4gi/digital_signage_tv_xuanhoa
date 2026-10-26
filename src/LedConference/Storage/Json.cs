using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace LedConference;

// One JSON setup for data files, the HTTP API and audit diffs: camelCase, HH:mm times, readable Vietnamese.
public static class Json
{
    public static readonly JsonSerializerOptions Options = Configure(new(JsonSerializerDefaults.Web) { WriteIndented = true });
    public static readonly JsonSerializerOptions Compact = Configure(new(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions o)
    {
        o.Converters.Add(new HourMinuteConverter());
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        o.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
        return o;
    }

    sealed class HourMinuteConverter : JsonConverter<TimeOnly>
    {
        static readonly string[] Formats = ["HH:mm", "H:mm", "HH:mm:ss"];

        public override TimeOnly Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            TimeOnly.TryParseExact(reader.GetString(), Formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)
                ? t
                : throw new JsonException("Giờ phải có dạng HH:mm.");

        public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.ToString("HH:mm", CultureInfo.InvariantCulture));
    }
}
